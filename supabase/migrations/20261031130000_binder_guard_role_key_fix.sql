-- 20261031130000 - Repair: binder document verification is broken.
--
-- private.hr_binder_documents_guard() (20261030120000) calls
-- private.role_key_in(array['administrator', 'hr']) with a single
-- argument, but the helper's signature is
-- private.role_key_in(p_agency_id uuid, p_keys text[])
-- (20260913120000_lifepath_chart_schema.sql). Every verify/return
-- transition that reaches the role branch - agency administrators
-- and HR-by-role, the two role paths the guard exists to allow -
-- dies with 42883 (undefined function) instead of landing or being
-- refused with P0001. In production that means an administrator or
-- HR user without the certificates.manage permission cannot verify
-- or return a binder document at all.
--
-- Forward-only fix (20261030120000 is already applied): recreate
-- the guard with the agency id passed, exactly as every other
-- role_key_in caller does. Nothing else in the function changes.
-- Caught by supabase/tests/new_hire_binder.sql in CI (10 failures,
-- all in the document-verification family).

create or replace function private.hr_binder_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if v_uid is not null then
      new.uploaded_by := v_uid;
      -- A new row is always a fresh upload awaiting verification.
      new.status := 'on_file';
      new.verified_by := null;
      new.verified_by_name := null;
      new.verified_at := null;
      new.return_note := null;
    end if;
    return new;
  end if;

  if new.agency_id is distinct from old.agency_id
     or new.binder_id is distinct from old.binder_id
     or new.staff_id is distinct from old.staff_id
     or new.item_key is distinct from old.item_key
     or new.created_at is distinct from old.created_at then
    raise exception 'A binder document''s identity cannot change.'
      using errcode = 'P0001';
  end if;
  new.updated_at := now();

  -- Verification transitions: only certificates.manage holders, and the
  -- stamp names the caller.
  if new.status in ('verified', 'returned') and old.status is distinct from new.status then
    if not (
      (select private.has_permission(new.agency_id, 'certificates.manage'))
      or (select private.role_key_in(new.agency_id, array['administrator', 'hr']))
    ) then
      raise exception 'Only HR can verify or return a binder document.'
        using errcode = 'P0001';
    end if;
    if new.status = 'verified' then
      new.verified_by := v_uid;
      new.verified_at := now();
      new.return_note := null;
    else
      if length(btrim(coalesce(new.return_note, ''))) = 0 then
        raise exception 'A reason is required to send a document back.'
          using errcode = 'P0001';
      end if;
      new.verified_by := null;
      new.verified_by_name := null;
      new.verified_at := null;
    end if;
  end if;

  -- A re-upload (file fields change) resets the row to awaiting
  -- verification, whoever sent it back before.
  if new.file_name is distinct from old.file_name
     or new.storage_path is distinct from old.storage_path
     or new.file_size is distinct from old.file_size then
    new.status := 'on_file';
    new.verified_by := null;
    new.verified_by_name := null;
    new.verified_at := null;
    new.return_note := null;
    new.uploaded_by := coalesce(v_uid, old.uploaded_by);
    new.uploaded_at := now();
  end if;
  return new;
end;
$$;
