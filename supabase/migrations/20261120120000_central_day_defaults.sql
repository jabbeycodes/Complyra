-- Central-day defaults wave: judge every server-side "today" on the
-- agency's America/Chicago calendar, never the database server's day.
--
-- The screens were aligned to the Central day in waves 7J/7Q and PR #252
-- (todayIso()/centralTodayIso()), and private.consent_current /
-- private.sweep_consents were aligned in migration 20261031260000. The
-- rest of the hosted surface still derived "today" from current_date —
-- the Supabase server's UTC day — so every evening from 6 PM CST /
-- 7 PM CDT the hosted side rolled to tomorrow hours before the agency
-- did: memberships and staff assignments read as expired/started on the
-- wrong day, scorecard and screening sweeps flipped requirements to
-- overdue early, validators rejected same-day signatures as "future",
-- and date defaults stamped tomorrow's date on tonight's records.
--
-- This migration changes ONLY the calendar those judgments read. Every
-- function and policy below is reproduced verbatim from its latest
-- definition with `current_date` replaced by
--   (now() at time zone 'America/Chicago')::date
-- and the five live `default current_date` date columns get the same
-- expression as their new default. No rule, scope, or audience changes.
--
-- UNAPPLIED — production application is a separate step, like every
-- migration.
begin;

-- ---------------------------------------------------------------------
-- Column defaults: a row created tonight gets tonight's Central date.
-- ---------------------------------------------------------------------
alter table public.staff_assignments
  alter column starts_on set default (now() at time zone 'America/Chicago')::date;
alter table public.med_dose_exceptions
  alter column occurred_on set default (now() at time zone 'America/Chicago')::date;
alter table public.hr_accrual_policies
  alter column effective_from set default (now() at time zone 'America/Chicago')::date;
alter table public.medication_orders
  alter column start_date set default (now() at time zone 'America/Chicago')::date;
alter table public.profiles
  alter column hired_on set default (now() at time zone 'America/Chicago')::date;

-- ---------------------------------------------------------------------
-- Functions: latest definitions, Central-day calendar.
-- ---------------------------------------------------------------------

-- private.can_grant_role_key(p_agency_id uuid, p_target_key text)  (latest definition: 20261031310000_remove_compliance_role.sql; 1 swap)
create or replace function private.can_grant_role_key(p_agency_id uuid, p_target_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select key_ok and hierarchy_ok
  from (
    select
      -- retired keys are evaluated as the roles they merged into
      case
        when p_target_key = 'degreed_professional_manager' then 'program_manager'
        when p_target_key = 'compliance_admin' then 'administrator'
        else p_target_key
      end as t
  ) norm
  cross join lateral (
    select
      norm.t in (
        'administrator', 'house_manager', 'program_manager',
        'dsp', 'nurse', 'hr', 'auditor'
      ) as key_ok,
      case
        when norm.t = 'administrator' then exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.agency_id = p_agency_id
            and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
            and m.role_key = 'administrator'
        )
        else true
      end as hierarchy_ok
  ) h;
$$;

-- private.can_read_site(p_agency_id uuid, p_site_id uuid)  (latest definition: 20261031160000_staff_scope_repair.sql; 2 swaps)
create or replace function private.can_read_site(p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_agency(p_agency_id) and exists (
    select 1 from memberships m join sites s on s.agency_id = m.agency_id
    where m.user_id = auth.uid() and m.agency_id = p_agency_id and s.id = p_site_id
      and (
        m.role_key in ('administrator','compliance_admin','degreed_professional_manager','program_manager','auditor','hr')
        or m.site_id = p_site_id
        or (m.role_key in ('dsp','nurse','house_manager') and exists (
          select 1 from staff_assignments a
          left join individuals ai
            on ai.id = a.individual_id and ai.agency_id = a.agency_id
          where a.agency_id = p_agency_id
            and a.user_id = auth.uid()
            and a.starts_on <= (now() at time zone 'America/Chicago')::date
            and (a.ends_on is null or a.ends_on >= (now() at time zone 'America/Chicago')::date)
            and coalesce(a.site_id, ai.site_id) = p_site_id
        ))
      )
  );
$$;

-- private.complete_consent_packet(p_id uuid, p_choices jsonb, p_signer jsonb, p_evidence jsonb, p_external boolean)  (latest definition: 20261031300000_packet_evidence_limit_4mb.sql; 1 swap)
create or replace function private.complete_consent_packet(p_id uuid,p_choices jsonb,p_signer jsonb,p_evidence jsonb,p_external boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.consent_packets;item jsonb;prior uuid;content bytea;
begin
 select * into p from public.consent_packets where id=p_id for update;
 if p.id is null or p.signed_at is not null or p.status='draft' then raise exception 'Packet unavailable or already signed.' using errcode='42501'; end if;
 if not p_external and not private.can_manage_consent(p.agency_id,p.individual_id) then raise exception 'Packet access denied.' using errcode='42501'; end if;
 perform private.validate_packet_submission(p_choices,p_signer,p);
 content:=decode(p_evidence->>'base64','base64');
 if content is null or octet_length(content) not between 1 and 4194304 or length(coalesce(p_evidence->>'name',''))=0 then raise exception 'Attach signed evidence up to 4 MB.'; end if;
 if not ((p_evidence->>'mime'='application/pdf' and substring(content from 1 for 5)=convert_to('%PDF-','UTF8')) or (not p_external and p_evidence->>'mime'='image/png' and substring(content from 1 for 4)=decode('89504e47','hex')) or (not p_external and p_evidence->>'mime'='image/jpeg' and substring(content from 1 for 2)=decode('ffd8','hex'))) then raise exception 'Unsupported signed evidence.'; end if;
 -- Serialize renewal creation for this Individual, including simultaneous packets.
 perform 1 from public.individuals where id=p.individual_id for update;
 update public.consent_packets set status='filed',signed_at=now(),filed_at=now(),choices=p_choices,signer=p_signer,evidence_name=p_evidence->>'name' where id=p.id returning * into p;
 for item in select * from jsonb_array_elements(p.snapshot->'items') loop
  prior:=null;
  select c.id into prior from public.individual_consents c where c.agency_id=p.agency_id and c.individual_id=p.individual_id and c.type_id=item->>'typeId' and c.activated_at is not null
  and not exists(select 1 from public.individual_consents n where n.supersedes_id=c.id and n.activated_at is not null) order by c.created_at desc limit 1 for update;
  insert into public.individual_consents(agency_id,individual_id,type_id,details,supersedes_id,created_by,activated_at,activated_by,packet_id)
  values(p.agency_id,p.individual_id,item->>'typeId',jsonb_build_object('covers',item->>'text','outcome',p_choices->>(item->>'key'),
   'giver',case when p_signer->>'authority'='Self' then 'individual' when p_signer->>'authority'='Guardian' then 'guardian' else 'representative' end,
   'giverName',p_signer->>'printedName','relationship',(p_signer->>'authority')||case when coalesce(p_signer->>'authorityOther','')<>'' then ': '||(p_signer->>'authorityOther') else '' end,
   'signedOn',p_signer->>'signedOn','effectiveOn',p.snapshot->>'effectiveOn','reviewOn',p.snapshot->>'reviewOn','packetId',p.id),prior,p.created_by,p.signed_at,auth.uid(),p.id);
 end loop;
 insert into public.consent_packet_evidence values(p.id,p.agency_id,p.individual_id,p_evidence);
 delete from private.consent_packet_tokens where packet_id=p.id;
 perform private.packet_audit(p,'signed');perform private.packet_audit(p,'filed');
 if exists(select 1 from public.memberships m where m.agency_id=p.agency_id and m.user_id=p.created_by and m.role_key in ('house_manager','program_manager','nurse') and (m.expires_on is null or m.expires_on>=(now() at time zone 'America/Chicago')::date)) then
 insert into public.notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
 values(p.agency_id,p.created_by,'consent.packet_signed','Consent packet filed',(p.snapshot->>'individualName')||': signed consent packet filed.','/consents','consent_packet',p.id::text,'consent.packet_signed:'||p.id::text||':'||p.created_by::text) on conflict do nothing;
 end if;
end;
$$;

-- private.consent_revocation_guard()  (latest definition: 20261027140000_consents_register.sql; 1 swap)
create or replace function private.consent_revocation_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.individual_consents;
begin
 if tg_op<>'INSERT' then raise exception 'Revocations are immutable.' using errcode='42501'; end if;
 select * into c from public.individual_consents where id=new.consent_id for update;
 if c.id is null or c.activated_at is null or not private.can_manage_consent(c.agency_id,c.individual_id) then raise exception 'Consent access denied.' using errcode='42501'; end if;
 if new.revoked_on< (c.details->>'signedOn')::date or new.revoked_on>(now() at time zone 'America/Chicago')::date then raise exception 'Invalid revocation date.'; end if;
 new.agency_id:=c.agency_id; new.individual_id:=c.individual_id; new.revoked_by:=auth.uid();
 select full_name into new.revoked_by_name from public.profiles where id=auth.uid();
 new.recorded_at:=now(); return new;
end;
$$;

-- private.corrective_action_identity_guard()  (latest definition: 20261031170000_hm_corrective_actions_seed.sql; 4 swaps)
create or replace function private.corrective_action_identity_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  placement_changed boolean := TG_OP = 'INSERT';
begin
  if TG_OP = 'UPDATE' then
    placement_changed :=
      new.site_id is distinct from old.site_id
      or new.assigned_to_user_id is distinct from old.assigned_to_user_id
      or new.qa_audit_id is distinct from old.qa_audit_id;
  end if;
  if new.title is null or trim(new.title) = '' then
    raise exception 'Give the corrective action a title.';
  end if;
  if new.assigned_to_user_id is not null and not exists (
    select 1 from memberships m
    where m.agency_id = new.agency_id and m.user_id = new.assigned_to_user_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  ) then raise exception 'Assign an active member of this agency.'; end if;
  if placement_changed then
    if new.site_id is not null and not exists (
      select 1 from sites s
      where s.id = new.site_id and s.agency_id = new.agency_id
    ) then raise exception 'Choose a home in this agency.'; end if;
    if new.qa_audit_id is not null and not exists (
      select 1 from qa_audits qa
      where qa.id = new.qa_audit_id and qa.agency_id = new.agency_id
        and (new.site_id is null or qa.site_id = new.site_id)
    ) then raise exception 'The corrective action''s home must match its QA review.'; end if;
    if new.site_id is not null and new.assigned_to_user_id is not null
      and not exists (
        select 1 from memberships m
        where m.agency_id = new.agency_id and m.user_id = new.assigned_to_user_id
          and m.site_id = new.site_id
          and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      )
      and not exists (
        select 1 from staff_assignments a
        left join individuals ai
          on ai.id = a.individual_id and ai.agency_id = a.agency_id
        where a.agency_id = new.agency_id and a.user_id = new.assigned_to_user_id
          and a.starts_on <= (now() at time zone 'America/Chicago')::date
          and (a.ends_on is null or a.ends_on >= (now() at time zone 'America/Chicago')::date)
          and coalesce(a.site_id, ai.site_id) = new.site_id
      )
    then raise exception 'Assign corrective actions to staff who work at that home.'; end if;
  end if;
  if TG_OP = 'INSERT' and auth.role() = 'authenticated' then
    new.created_by_user_id := auth.uid();
  elsif TG_OP = 'UPDATE' and (
    new.agency_id <> old.agency_id
    or new.created_by_user_id <> old.created_by_user_id
    or new.id <> old.id
  ) then
    raise exception 'Corrective action identity cannot be changed.';
  end if;
  return new;
end $$;

-- private.dsp_works_at_site(p_agency_id uuid, p_site_id uuid)  (latest definition: 20261031160000_staff_scope_repair.sql; 1 swap)
create or replace function private.dsp_works_at_site(p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from staff_assignments a
    left join individuals ai
      on ai.id = a.individual_id and ai.agency_id = a.agency_id
    where a.agency_id = p_agency_id and a.user_id = auth.uid()
      and a.starts_on <= (now() at time zone 'America/Chicago')::date
      and coalesce(a.site_id, ai.site_id) = p_site_id
  ) or exists (
    select 1 from memberships m
    where m.agency_id = p_agency_id and m.user_id = auth.uid()
      and m.site_id = p_site_id
  );
$$;

-- private.guard_last_administrator()  (latest definition: 20260913191500_phase0_security.sql; 5 swaps)
create or replace function private.guard_last_administrator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_remaining integer;
  v_was_admin_active boolean;
  v_stays_admin_active boolean;
begin
  if tg_op = 'DELETE' then
    v_agency_id := old.agency_id;
    v_was_admin_active :=
      old.role_key = 'administrator'
      and (old.expires_on is null or old.expires_on >= (now() at time zone 'America/Chicago')::date);
    if v_was_admin_active then
      select count(*) into v_remaining
      from public.memberships m
      where m.agency_id = v_agency_id
        and m.id <> old.id
        and m.role_key = 'administrator'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date);
      if v_remaining = 0 then
        raise exception 'Cannot remove the last active agency administrator.';
      end if;
    end if;
    return old;
  end if;

  -- UPDATE
  v_agency_id := new.agency_id;
  v_was_admin_active :=
    old.role_key = 'administrator'
    and (old.expires_on is null or old.expires_on >= (now() at time zone 'America/Chicago')::date);
  v_stays_admin_active :=
    new.role_key = 'administrator'
    and (new.expires_on is null or new.expires_on >= (now() at time zone 'America/Chicago')::date);
  if v_was_admin_active and not v_stays_admin_active then
    select count(*) into v_remaining
    from public.memberships m
    where m.agency_id = v_agency_id
      and m.id <> old.id
      and m.role_key = 'administrator'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date);
    if v_remaining = 0 then
      raise exception 'Cannot demote or deactivate the last active agency administrator.';
    end if;
  end if;
  return new;
end;
$$;

-- private.guard_requirement_write()  (latest definition: 20260915023000_audit_access_boundaries.sql; 1 swap)
create or replace function private.guard_requirement_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.individual_id is not null and not exists (
    select 1 from individuals i where i.id = new.individual_id and i.agency_id = new.agency_id and i.site_id = new.site_id
  ) then raise exception 'The individual does not belong to this site.'; end if;
  if new.owner_user_id is not null and not exists (
    select 1 from memberships m where m.user_id = new.owner_user_id and m.agency_id = new.agency_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  ) then raise exception 'Choose an active staff member in this agency.'; end if;
  if new.document_version_id is not null and new.individual_id is not null and not exists (
    select 1 from document_versions v join documents d on d.id = v.document_id
    where v.id = new.document_version_id and d.agency_id = new.agency_id and d.individual_id = new.individual_id
  ) then raise exception 'The source document belongs to a different individual.'; end if;
  if length(trim(new.title)) = 0 then raise exception 'Enter a title for the requirement.'; end if;
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' and new.status <> 'pending_review' then
      raise exception 'New requirements must be reviewed before activation.';
    end if;
    if tg_op = 'UPDATE' and not private.can_approve(new.agency_id) then
      if not private.has_permission(new.agency_id, 'requirements.complete')
        or old.owner_user_id is distinct from auth.uid()
        or old.status = 'pending_review'
        or new.status <> 'compliant'
        or (to_jsonb(new) - array['status','evidence_note','completed_at','updated_at'])
          is distinct from (to_jsonb(old) - array['status','evidence_note','completed_at','updated_at']) then
        raise exception 'You may only complete your assigned, approved requirements.';
      end if;
    end if;
    if new.status = 'compliant' and (tg_op = 'INSERT' or old.status <> 'compliant') then
      if length(trim(new.evidence_note)) = 0 then raise exception 'A completion record is required.'; end if;
      new.completed_at := now();
    end if;
  end if;
  return new;
end $$;

-- private.guard_time_off_transition()  (latest definition: 20261027210000_time_off.sql; 1 swap)
create or replace function private.guard_time_off_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Identity fields never move.
  if new.staff_id <> old.staff_id or new.agency_id <> old.agency_id then
    raise exception 'A time-off request cannot change owner or agency.'
      using errcode = '23514';
  end if;

  -- Closed requests are immutable.
  if old.status in ('denied', 'cancelled') then
    raise exception 'This time-off request is % and can no longer change.', old.status
      using errcode = '23514';
  end if;

  -- A range edit must keep every day row inside the range.
  if (new.starts_on <> old.starts_on or new.ends_on <> old.ends_on)
     and exists (
       select 1 from public.hr_time_off_request_days d
       where d.request_id = old.id
         and (d.day_date < new.starts_on or d.day_date > new.ends_on)
     ) then
    raise exception 'The new dates would leave a day outside the request range.'
      using errcode = '23514';
  end if;

  if new.status = old.status then
    -- No transition: while pending, decision/cancellation stamps stay empty.
    if old.status = 'pending'
       and (new.decided_by is not null or new.cancelled_by is not null) then
      raise exception 'A pending request cannot carry a decision or cancellation.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('approved', 'denied') then
    if new.decided_by is distinct from auth.uid() or new.decided_at is null then
      raise exception 'A decision must be stamped with the deciding manager.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'pending' and new.status = 'cancelled' then
    if new.cancelled_by is distinct from auth.uid() or new.cancelled_at is null then
      raise exception 'A cancellation must be stamped with who cancelled it.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'approved' and new.status = 'cancelled' then
    -- Manager-only path (RLS decides who may write at all): before the
    -- start date, with a reason, stamped with the canceller.
    if new.cancelled_by is distinct from auth.uid() or new.cancelled_at is null then
      raise exception 'A cancellation must be stamped with who cancelled it.'
        using errcode = '23514';
    end if;
    if old.starts_on <= (now() at time zone 'America/Chicago')::date then
      raise exception 'This time off has already started and can no longer be cancelled.'
        using errcode = '23514';
    end if;
    if new.cancel_reason is null or btrim(new.cancel_reason) = '' then
      raise exception 'Cancelling approved time off requires a reason.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Time-off requests cannot move from % to %.', old.status, new.status
    using errcode = '23514';
end;
$$;

-- private.has_agency(p_agency_id uuid)  (latest definition: 20260915023000_audit_access_boundaries.sql; 1 swap)
create or replace function private.has_agency(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    join profiles p on p.id = m.user_id
    join agencies a on a.id = m.agency_id
    where m.user_id = auth.uid() and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and p.active and not p.must_change_password and a.active and a.status = 'active'
  );
$$;

-- private.has_permission(p_agency_id uuid, p_key text)  (latest definition: 20260912000000_role_templates.sql; 1 swap)
create or replace function private.has_permission(p_agency_id uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (ar.permissions ->> p_key)::boolean
    from public.memberships m
    join public.agency_roles ar
      on ar.agency_id = m.agency_id
     and ar.template_key = coalesce(m.role_key, m.role::text)
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    limit 1
  ), false);
$$;

-- private.has_site(p_agency_id uuid, p_site_id uuid)  (latest definition: 20260914070000_delegation_templates.sql; 1 swap)
create or replace function private.has_site(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and (m.site_id = p_site_id or m.site_id is null)
  );
$$;

-- private.hr_hm_site_in_scope(p_agency_id uuid, p_site_id uuid)  (latest definition: 20261112230000_hr_data_scoping.sql; 3 swaps)
create or replace function private.hr_hm_site_in_scope(
  p_agency_id uuid, p_site_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and p_site_id is not null
      and (
        m.site_id is null
        or m.site_id = p_site_id
        or exists (
          select 1
          from public.staff_assignments sa
          where sa.user_id = auth.uid()
            and sa.agency_id = p_agency_id
            and sa.site_id = p_site_id
            and sa.starts_on <= (now() at time zone 'America/Chicago')::date
            and (sa.ends_on is null or sa.ends_on >= (now() at time zone 'America/Chicago')::date)
        )
      )
  );
$$;

-- private.hr_hm_subject_in_scope(p_agency_id uuid, p_staff_id uuid)  (latest definition: 20261112230000_hr_data_scoping.sql; 6 swaps)
create or replace function private.hr_hm_subject_in_scope(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and (
        m.site_id is null
        or exists (
          select 1
          from (
            select m.site_id as site_id
            union
            select sa.site_id
            from public.staff_assignments sa
            where sa.user_id = auth.uid()
              and sa.agency_id = p_agency_id
              and sa.site_id is not null
              and sa.starts_on <= (now() at time zone 'America/Chicago')::date
              and (sa.ends_on is null or sa.ends_on >= (now() at time zone 'America/Chicago')::date)
          ) viewer_sites
          join (
            select sm.site_id as site_id
            from public.memberships sm
            where sm.user_id = p_staff_id
              and sm.agency_id = p_agency_id
              and (sm.expires_on is null or sm.expires_on >= (now() at time zone 'America/Chicago')::date)
              and sm.site_id is not null
            union
            select sa2.site_id
            from public.staff_assignments sa2
            where sa2.user_id = p_staff_id
              and sa2.agency_id = p_agency_id
              and sa2.site_id is not null
              and sa2.starts_on <= (now() at time zone 'America/Chicago')::date
              and (sa2.ends_on is null or sa2.ends_on >= (now() at time zone 'America/Chicago')::date)
          ) subject_sites on subject_sites.site_id = viewer_sites.site_id
        )
      )
  );
$$;

-- private.is_agency_admin(p_agency_id uuid)  (latest definition: 20260912000000_role_templates.sql; 1 swap)
create or replace function private.is_agency_admin(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and role in ('administrator', 'compliance_admin')
      and (expires_on is null or expires_on >= (now() at time zone 'America/Chicago')::date)
  );
$$;

-- private.is_privileged(p_agency_id uuid)  (latest definition: 20260912000000_role_templates.sql; 1 swap)
create or replace function private.is_privileged(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      and role in ('administrator', 'compliance_admin', 'manager')
      and (expires_on is null or expires_on >= (now() at time zone 'America/Chicago')::date)
  );
$$;

-- private.med_admin_cleared(p_agency_id uuid, p_user_id uuid)  (latest definition: 20261105120000_training_signoff_completes_line.sql; 1 swap)
create or replace function private.med_admin_cleared(p_agency_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with reqs as (
    select r.id, r.site_id,
      case
        when r.status = 'waived_na' then 'waived_na'
        when private.training_line_initialed(r.id) then 'complete'
        when r.status = 'overdue' or r.due_on < (now() at time zone 'America/Chicago')::date then 'overdue'
        else 'pending'
      end as resolved_status
    from public.training_requirements r
    where r.agency_id = p_agency_id and r.user_id = p_user_id
  ),
  hours as (
    select coalesce(sum(greatest(s.hours_total, 0)), 0) as total,
           coalesce(sum(greatest(s.hours_with_hm, 0)), 0) as with_hm
    from reqs q
    join public.training_signoffs s on s.requirement_id = q.id
    where not s.na
      and q.resolved_status = 'complete'
  ),
  sites as (select distinct site_id from reqs where site_id is not null)
  select
    (select count(*) from reqs) > 0
    and (select total from hours) >= 20
    and (select with_hm from hours) >= 8
    and not exists (select 1 from reqs where resolved_status = 'overdue')
    and not exists (
      select 1 from reqs
      where resolved_status not in ('complete', 'waived_na', 'overdue')
    )
    and exists (select 1 from sites)
    and not exists (
      select 1 from sites st
      where not exists (
        select 1 from public.training_countersignatures c
        where c.agency_id = p_agency_id
          and c.user_id = p_user_id
          and c.site_id = st.site_id
          and c.staff_signed_at is not null
          and c.hm_signed_at is not null
      )
    );
$$;

-- private.membership_current(p_agency_id uuid)  (latest definition: 20260912000000_role_templates.sql; 1 swap)
create or replace function private.membership_current(p_agency_id uuid)
returns public.memberships
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.memberships
  where user_id = auth.uid()
    and agency_id = p_agency_id
    and (expires_on is null or expires_on >= (now() at time zone 'America/Chicago')::date)
  limit 1;
$$;

-- private.notify_open_shift(p_shift public.hr_open_shifts, p_title text, p_body text)  (latest definition: 20260925150000_open_shifts.sql; 1 swap)
create or replace function private.notify_open_shift(p_shift public.hr_open_shifts, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  select distinct p_shift.agency_id, m.user_id, 'hr.open_shift_posted', p_title, p_body,
         '/hub/open-shifts', 'hr_open_shift', p_shift.id::text,
         'open_shift:' || p_shift.id || ':' || m.user_id
  from memberships m
  where m.agency_id = p_shift.agency_id
    and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    and m.user_id <> p_shift.posted_by
    and (
      p_shift.audience = 'agency'
      or private.is_trained_at_site(p_shift.agency_id, p_shift.site_id, m.user_id)
    )
  on conflict (agency_id, dedupe_key) do nothing;
end;
$$;

-- private.notify_permission_holders(p_agency_id uuid, p_site_id uuid, p_permission text, p_type text, p_title text, p_body text, p_deep_link text, p_entity_type text, p_entity_id text, p_dedupe_key text)  (latest definition: 20260914120000_pcsp_extraction.sql; 1 swap)
create or replace function private.notify_permission_holders(
  p_agency_id uuid,
  p_site_id uuid,
  p_permission text,
  p_type text,
  p_title text,
  p_body text,
  p_deep_link text,
  p_entity_type text,
  p_entity_id text,
  p_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link,
     entity_type, entity_id, dedupe_key)
  select distinct
    p_agency_id,
    m.user_id,
    p_type,
    p_title,
    p_body,
    p_deep_link,
    p_entity_type,
    p_entity_id,
    p_dedupe_key || ':' || m.user_id::text
  from public.memberships m
  join public.agency_roles ar
    on ar.agency_id = m.agency_id
   and ar.template_key = coalesce(m.role_key, m.role::text)
  where m.agency_id = p_agency_id
    and (p_site_id is null or m.site_id = p_site_id or m.site_id is null)
    and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    and coalesce((ar.permissions ->> p_permission)::boolean, false)
  on conflict (agency_id, dedupe_key) do nothing;
end;
$$;

-- private.performance_chain_member(p_agency_id uuid, p_staff_id uuid)  (latest definition: 20261030150000_performance_records.sql; 2 swaps)
create or replace function private.performance_chain_member(
  p_agency_id uuid, p_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.has_permission(p_agency_id, 'hub.view_team'))
    and exists (
      select 1
      from public.memberships viewer
      where viewer.user_id = auth.uid()
        and viewer.agency_id = p_agency_id
        and (viewer.expires_on is null or viewer.expires_on >= (now() at time zone 'America/Chicago')::date)
        and (
          viewer.role_key in ('administrator', 'compliance_admin', 'program_manager')
          or (
            viewer.role_key = 'house_manager'
            and exists (
              select 1
              from public.memberships subj
              where subj.user_id = p_staff_id
                and subj.agency_id = p_agency_id
                and (subj.expires_on is null or subj.expires_on >= (now() at time zone 'America/Chicago')::date)
                and subj.site_id is not null
                and (viewer.site_id is null or viewer.site_id = subj.site_id)
            )
          )
        )
    )
$$;

-- private.recognition_manager_view(p_agency_id uuid, p_user_a uuid, p_user_b uuid)  (latest definition: 20260914060000_recognition.sql; 1 swap)
create or replace function private.recognition_manager_view(
  p_agency_id uuid,
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.agency_id = p_agency_id
      and m.user_id = auth.uid()
      and m.role_key in ('administrator', 'compliance_admin')
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  )
  or (select private.share_active_site(p_agency_id, auth.uid(), p_user_a))
  or (select private.share_active_site(p_agency_id, auth.uid(), p_user_b));
$$;

-- private.role_key_in(p_agency_id uuid, p_keys text[])  (latest definition: 20261031310000_remove_compliance_role.sql; 1 swap)
create or replace function private.role_key_in(p_agency_id uuid, p_keys text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and agency_id = p_agency_id
      -- retired keys: the merged roles carry their access forward
      and role_key = any(
        array_replace(
          array_replace(p_keys, 'degreed_professional_manager', 'program_manager'),
          'compliance_admin', 'administrator'
        )
      )
      and (expires_on is null or expires_on >= (now() at time zone 'America/Chicago')::date)
  );
$$;

-- private.share_active_site(p_agency_id uuid, p_user_a uuid, p_user_b uuid)  (latest definition: 20260914060000_recognition.sql; 6 swaps)
create or replace function private.share_active_site(
  p_agency_id uuid,
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    with a_sites as (
      select m.site_id
      from public.memberships m
      where m.agency_id = p_agency_id
        and m.user_id = p_user_a
        and m.site_id is not null
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      union
      select sa.site_id
      from public.staff_assignments sa
      where sa.agency_id = p_agency_id
        and sa.user_id = p_user_a
        and sa.site_id is not null
        and sa.starts_on <= (now() at time zone 'America/Chicago')::date
        and (sa.ends_on is null or sa.ends_on >= (now() at time zone 'America/Chicago')::date)
    )
    select 1
    from a_sites s
    where exists (
      select 1
      from public.memberships m
      where m.agency_id = p_agency_id
        and m.user_id = p_user_b
        and m.site_id = s.site_id
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
    or exists (
      select 1
      from public.staff_assignments sa
      where sa.agency_id = p_agency_id
        and sa.user_id = p_user_b
        and sa.site_id = s.site_id
        and sa.starts_on <= (now() at time zone 'America/Chicago')::date
        and (sa.ends_on is null or sa.ends_on >= (now() at time zone 'America/Chicago')::date)
    )
  );
$$;

-- private.sweep_packet_alerts(p_agency_id uuid, p_scoped boolean)  (latest definition: 20261104120000_unmarked_dose_notice_dedupe_consent_audience.sql; 1 swap)
create or replace function private.sweep_packet_alerts(p_agency_id uuid,p_scoped boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;t record;
begin
 for p in select cp.*,i.site_id from public.consent_packets cp join public.individuals i on i.id=cp.individual_id where cp.agency_id=p_agency_id and cp.status='sent' and cp.sent_at+make_interval(days=>cp.outstanding_after_days)<=now() and (not p_scoped or private.can_read_individual(cp.agency_id,cp.individual_id)) loop
  for t in select distinct m.user_id,null::text role_key,m.user_id::text target from public.memberships m where m.agency_id=p_agency_id and m.role_key='house_manager' and (m.site_id is null or m.site_id=p.site_id) and (m.expires_on is null or m.expires_on>=(now() at time zone 'America/Chicago')::date)
   union all select null::uuid,'program_manager','program_manager'
   union all select null::uuid,'administrator','administrator'
   union all select null::uuid,'nurse','nurse' loop
   insert into public.notifications(agency_id,user_id,role_key,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
   values(p_agency_id,t.user_id,t.role_key,'consent.packet_outstanding','Outstanding consent packet',(p.snapshot->>'individualName')||': consent packet remains unsigned.','/consents','consent_packet',p.id::text,'consent.packet_outstanding:'||p.id::text||':'||t.target) on conflict do nothing;
  end loop;
 end loop;
end;
$$;

-- private.time_off_hr_visible(p_agency_id uuid)  (latest definition: 20261027210000_time_off.sql; 1 swap)
create or replace function private.time_off_hr_visible(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'hr'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  );
$$;

-- private.time_off_is_auditor(p_agency_id uuid)  (latest definition: 20261027210000_time_off.sql; 1 swap)
create or replace function private.time_off_is_auditor(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = p_agency_id
      and m.role_key = 'auditor'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  );
$$;

-- private.time_off_team_visible(p_agency_id uuid, p_site_id uuid)  (latest definition: 20261027210000_time_off.sql; 1 swap)
create or replace function private.time_off_team_visible(p_agency_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select private.has_permission(p_agency_id, 'hub.view_team'))
    and exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
        and (
          m.role_key in ('administrator', 'compliance_admin', 'program_manager')
          or (
            m.role_key = 'house_manager'
            and p_site_id is not null
            and (m.site_id is null or m.site_id = p_site_id)
          )
        )
    );
$$;

-- private.validate_consent(p_draft jsonb, p_types jsonb, p_activate boolean)  (latest definition: 20261027140000_consents_register.sql; 1 swap)
create or replace function private.validate_consent(p_draft jsonb,p_types jsonb,p_activate boolean default false) returns void
language plpgsql set search_path = public, pg_temp as $$
declare f text; v text;
begin
 if not exists(select 1 from jsonb_array_elements(p_types) t where t->>'id'=p_draft->>'typeId') then raise exception 'Choose a consent type.'; end if;
 if coalesce(p_draft->>'outcome','') not in ('','yes','no','full','group','none') then raise exception 'Choose a valid consent decision.'; end if;
 if coalesce(p_draft->>'giver','') not in ('individual','guardian','representative') then raise exception 'Choose who gave consent.'; end if;
 foreach f in array array['covers','giverName','relationship'] loop
  if length(trim(coalesce(p_draft->>f,'')))=0 then raise exception 'Describe the consent, giver name, and relationship.'; end if;
 end loop;
 foreach f in array array['effectiveOn','reviewOn','signedOn'] loop
  v:=p_draft->>f;
  if f='signedOn' and coalesce(v,'')='' and not p_activate then continue; end if;
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Use a valid date.'; end if;
 end loop;
 if (p_draft->>'reviewOn')::date < (p_draft->>'effectiveOn')::date then raise exception 'Review date must be on or after the effective date.'; end if;
 if p_activate and ((p_draft->>'signedOn')::date > (now() at time zone 'America/Chicago')::date or (p_draft->>'signedOn')::date > (p_draft->>'reviewOn')::date) then raise exception 'Record a valid signed date before activation.'; end if;
end;
$$;

-- private.validate_packet_submission(p_choices jsonb, p_signer jsonb, p public.consent_packets)  (latest definition: 20261027180000_consent_packets.sql; 1 swap)
create or replace function private.validate_packet_submission(p_choices jsonb,p_signer jsonb,p public.consent_packets) returns void
language plpgsql set search_path=public,pg_temp as $$
declare item jsonb;f text;
begin
 if jsonb_typeof(p_choices) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_choices))<>9 then raise exception 'Complete all nine packet choices.'; end if;
 for item in select * from jsonb_array_elements(p.snapshot->'items') loop
  if coalesce(p_choices->>(item->>'key'),'')<>all(case when item->>'key'='media' then array['full','group','none'] else array['yes','no'] end) then raise exception 'Invalid packet choice.'; end if;
 end loop;
 foreach f in array array['printedName','signature','witness'] loop
  if length(trim(coalesce(p_signer->>f,''))) not between 1 and 500 then raise exception 'Complete signer, signature, and witness.'; end if;
 end loop;
 if p_signer->'accepted' is distinct from 'true'::jsonb or coalesce(p_signer->>'authority','') not in ('Self','Parent','Guardian','Medical Power of Attorney','Other') or (p_signer->>'authority'='Other' and length(trim(coalesce(p_signer->>'authorityOther','')))=0) then raise exception 'State legal authority and signing agreement.'; end if;
 if p_signer->>'signedOn' is null or (p_signer->>'signedOn') !~ '^\d{4}-\d{2}-\d{2}$' or (p_signer->>'signedOn')::date>(now() at time zone 'America/Chicago')::date or (p_signer->>'signedOn')::date>(p.snapshot->>'reviewOn')::date then raise exception 'Use a valid signing date.'; end if;
end;
$$;

-- public.activate_trackable_item(p_item_id uuid)  (latest definition: 20260914120000_pcsp_extraction.sql; 1 swap)
create or replace function public.activate_trackable_item(
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.document_trackable_items%rowtype;
  v_upload public.document_uploads%rowtype;
  v_extraction public.document_extractions%rowtype;
  v_individual public.individuals%rowtype;
  v_site public.sites%rowtype;
  v_protocol_name text;
  v_template public.delegation_templates%rowtype;
  v_activation public.site_delegation_activations%rowtype;
  v_assignment public.individual_delegation_assignments%rowtype;
  v_material public.delegation_training_materials%rowtype;
  v_draft jsonb;
  v_mark text := 'Digital record generated by Complyrer.';
begin
  select * into v_item from public.document_trackable_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'Trackable item not found.';
  end if;
  if not private.has_permission(v_item.agency_id, 'documents.review') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_item.status <> 'approved' then
    raise exception 'Only approved items can be activated.';
  end if;

  select * into v_extraction
  from public.document_extractions where id = v_item.extraction_id;
  select * into v_upload
  from public.document_uploads where id = v_extraction.upload_id;
  select * into v_individual
  from public.individuals
  where id = v_upload.individual_id and agency_id = v_upload.agency_id;
  select * into v_site
  from public.sites
  where id = v_upload.site_id and agency_id = v_upload.agency_id;

  -- Protocol handoff into the delegation system.
  if v_item.item_type = 'protocol_needs_delegation' then
    v_protocol_name := coalesce(
      nullif(btrim(v_item.detail ->> 'protocol_name'), ''),
      nullif(btrim(v_item.title), ''),
      'PCSP protocol'
    );

    -- 1. Ensure an agency delegation template for this protocol (reuse an
    --    existing active one with the same name, or seed a new one from
    --    the extracted detail).
    select * into v_template
    from public.delegation_templates t
    where t.agency_id = v_item.agency_id
      and t.active
      and lower(btrim(t.name)) = lower(btrim(v_protocol_name))
    limit 1;

    if v_template.id is null then
      insert into public.delegation_templates
        (agency_id, name, category, sections, individualization_note, active)
      values (
        v_item.agency_id,
        v_protocol_name,
        coalesce(nullif(btrim(v_item.detail ->> 'category'), ''), 'PCSP'),
        jsonb_build_object(
          'purpose', coalesce(v_item.detail ->> 'description',
                              v_item.detail ->> 'support_strategies', ''),
          'steps', coalesce(v_item.detail -> 'support_strategies', '[]'::jsonb),
          'safetyWarnings', coalesce(v_item.detail -> 'safety_warnings', '[]'::jsonb),
          'documentation', coalesce(v_item.detail -> 'documentation', '[]'::jsonb)
        ),
        'Seeded from PCSP extraction on ' || to_char(now(), 'YYYY-MM-DD') ||
          '. Individualize before publication. ' || v_mark,
        true
      )
      returning * into v_template;
    end if;

    -- 2. Activate for the site (reactivate if previously deactivated).
    update public.site_delegation_activations
    set status = 'active', activated_at = now(), activated_by = auth.uid()
    where template_id = v_template.id
      and site_id = v_site.id
      and status = 'deactivated'
    returning * into v_activation;

    if not found then
      insert into public.site_delegation_activations
        (agency_id, template_id, site_id, status, activated_by)
      values (v_item.agency_id, v_template.id, v_site.id, 'active', auth.uid())
      on conflict do nothing;
      select * into v_activation
      from public.site_delegation_activations
      where template_id = v_template.id
        and site_id = v_site.id
        and status = 'active'
      limit 1;
    end if;

    -- 3. Assign to the individual (reuse an active assignment).
    select * into v_assignment
    from public.individual_delegation_assignments
    where activation_id = v_activation.id
      and individual_id = v_individual.id
      and status = 'assigned'
    limit 1;

    if v_assignment.id is null then
      insert into public.individual_delegation_assignments
        (agency_id, activation_id, template_id, individual_id, site_id,
         status, assigned_by)
      values
        (v_item.agency_id, v_activation.id, v_template.id, v_individual.id,
         v_site.id, 'assigned', auth.uid())
      returning * into v_assignment;
    end if;

    -- 4. Create the editable training draft (reuse an existing one).
    select * into v_material
    from public.delegation_training_materials
    where assignment_id = v_assignment.id
    limit 1;

    if v_material.id is null then
      v_draft := jsonb_build_object(
        'templateId', v_template.id,
        'templateName', v_template.name,
        'individualId', v_individual.id,
        'individualName', v_individual.full_name,
        'siteId', v_site.id,
        'siteName', v_site.name,
        'purpose', v_template.sections ->> 'purpose',
        'steps', coalesce(v_template.sections -> 'steps', '[]'::jsonb),
        'safetyWarnings', coalesce(v_template.sections -> 'safetyWarnings', '[]'::jsonb),
        'documentation', coalesce(v_template.sections -> 'documentation', '[]'::jsonb),
        'individualNotes', '',
        'individualizationNote', v_template.individualization_note,
        'sourceTrackableItemId', v_item.id,
        'generatedMark', v_mark
      );

      insert into public.delegation_training_materials
        (agency_id, assignment_id, site_id, status, draft_content)
      values
        (v_item.agency_id, v_assignment.id, v_site.id, 'draft', v_draft)
      returning * into v_material;

      -- Notify reviewers, as assign_delegation() does.
      insert into public.notifications
        (agency_id, user_id, type, title, body, deep_link,
         entity_type, entity_id, dedupe_key)
      select distinct
        v_item.agency_id,
        m.user_id,
        'delegation.review_ready',
        'Delegation ready for review',
        v_template.name || ' was assigned to ' || v_individual.full_name ||
          ' at ' || v_site.name ||
          ' (from PCSP extraction). Review and individualize the training draft.',
        '/delegations/templates',
        'delegation_assignment',
        v_assignment.id::text,
        'pcsp.delegation:' || v_assignment.id::text || ':' || m.user_id::text
      from public.memberships m
      join public.agency_roles ar
        on ar.agency_id = m.agency_id
       and ar.template_key = coalesce(m.role_key, m.role::text)
      where m.agency_id = v_item.agency_id
        and (m.site_id = v_site.id or m.site_id is null)
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
        and coalesce((ar.permissions ->> 'delegation.training.review')::boolean, false)
      on conflict (agency_id, dedupe_key) do nothing;
    end if;
  end if;

  update public.document_trackable_items
  set status = 'activated', updated_at = now()
  where id = p_item_id
  returning * into v_item;

  insert into public.document_audit_log (agency_id, upload_id, actor, action, detail)
  values (
    v_item.agency_id, v_upload.id, auth.uid(), 'item_activated',
    jsonb_build_object(
      'item_id', p_item_id,
      'item_type', v_item.item_type,
      'delegation_assignment_id',
        case when v_item.item_type = 'protocol_needs_delegation'
             then v_assignment.id else null end
    )
  );

  -- The item is now tracked: reviewers at the site get a bell notification.
  -- (Protocol items already notified training reviewers via the delegation
  -- handoff above; this covers the tracking event itself.)
  perform private.notify_permission_holders(
    v_item.agency_id, v_upload.site_id, 'documents.review',
    'document.item_activated',
    'Trackable item activated',
    v_item.title || ' is now tracked.',
    '/documents/extractions/' || v_upload.id::text,
    'document_trackable_item', v_item.id::text,
    'document.item_activated:' || v_item.id::text
  );

  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'delegation_assignment_id',
      case when v_item.item_type = 'protocol_needs_delegation'
           then v_assignment.id else null end
  );
end;
$$;

-- public.agency_scorecard(p_agency_id uuid)  (latest definition: 20261031231000_agency_scorecard_scope.sql; 2 swaps)
create or replace function public.agency_scorecard(p_agency_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (private.has_agency(p_agency_id) or private.is_platform_admin()) then
    raise exception 'Agency outside your access' using errcode = '42501';
  end if;
  return (
    with scoped as (
      select case
        when r.status in ('compliant','pending_review') then r.status::text
        when r.due_on < (now() at time zone 'America/Chicago')::date then
          case when r.category ~* 'delegat' then 'expired' else 'overdue' end
        when r.due_on <= (now() at time zone 'America/Chicago')::date + 7 then 'due_soon'
        else 'upcoming'
      end as status
      from public.requirement_definitions r
      where r.agency_id = p_agency_id and (
        private.is_platform_admin()
        or private.role_key_in(p_agency_id, array['hr'])
        or (
          private.has_permission(p_agency_id, 'individuals.view')
          and private.can_read_site(p_agency_id, r.site_id)
          and (r.individual_id is null or private.can_read_individual(p_agency_id, r.individual_id))
        )
      )
    ), active as (select * from scoped where status <> 'pending_review')
    select jsonb_build_object(
      'score', case when (select count(*) from active) = 0 then 100
        else round(100.0 * (select count(*) from active where status = 'compliant') / (select count(*) from active)) end,
      'total', (select count(*) from active),
      'done', (select count(*) from active where status = 'compliant'),
      'overdue', (select count(*) from active where status in ('overdue','expired')),
      'dueSoon', (select count(*) from active where status = 'due_soon'),
      'review', (select count(*) from scoped where status = 'pending_review')
    )
  );
end;
$$;

-- public.apply_accrual_carryover(p_agency_id uuid, p_as_of date)  (latest definition: 20260916130000_hr_phase2_accrual_overtime_swaps.sql; 1 swap)
create or replace function public.apply_accrual_carryover(
  p_agency_id uuid,
  p_as_of date default (now() at time zone 'America/Chicago')::date
)
returns table (
  staff_id uuid,
  leave_type text,
  carried numeric,
  forfeited numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_year int := extract(year from p_as_of)::int;
  v_cal_boundary date := make_date(v_year, 1, 1);
  v_boundary date;
  v_anchor date;
  v_anniversary date;
  v_m int;
  v_d int;
  v_leap boolean := (v_year % 4 = 0) and (v_year % 100 <> 0 or v_year % 400 = 0);
  v_balance numeric;
  v_carried numeric;
  v_forfeited numeric;
begin
  -- Staff + leave types covered by an active policy as of the run date.
  for r in
    select distinct
      l.staff_id,
      l.leave_type,
      p.carryover_cap_hours,
      p.carryover_basis
    from public.hr_accrual_ledger l
    join public.hr_accrual_policies p
      on p.agency_id = l.agency_id
     and p.leave_type = l.leave_type
     and p.active
     and p.effective_from <= p_as_of
     and (p.effective_to is null or p.effective_to >= p_as_of)
    where l.agency_id = p_agency_id
  loop
    if r.carryover_basis = 'anniversary' then
      -- profiles carries no hire-date column, so anchor the anniversary year
      -- to this staff member's earliest ledger period_start for the leave
      -- type (see header note).
      select min(l2.period_start) into v_anchor
      from public.hr_accrual_ledger l2
      where l2.agency_id = p_agency_id
        and l2.staff_id = r.staff_id
        and l2.leave_type = r.leave_type;
      v_m := extract(month from v_anchor)::int;
      v_d := extract(day from v_anchor)::int;
      if v_m = 2 and v_d = 29 and not v_leap then
        v_d := 28;
      end if;
      v_anniversary := make_date(v_year, v_m, v_d);
      if v_anniversary > p_as_of then
        v_anniversary := (v_anniversary - interval '1 year')::date;
      end if;
      v_boundary := v_anniversary;
    else
      v_boundary := v_cal_boundary;
    end if;

    -- Latest balance before the carryover boundary.
    select l3.balance into v_balance
    from public.hr_accrual_ledger l3
    where l3.agency_id = p_agency_id
      and l3.staff_id = r.staff_id
      and l3.leave_type = r.leave_type
      and l3.period_start < v_boundary
    order by l3.period_start desc, l3.created_at desc
    limit 1;

    if v_balance is null or v_balance <= 0 then
      continue;
    end if;

    v_carried := least(v_balance, r.carryover_cap_hours);
    v_forfeited := greatest(v_balance - r.carryover_cap_hours, 0);

    insert into public.hr_accrual_ledger
      (agency_id, staff_id, pay_period_id, period_start, leave_type,
       accrued, used, adjustment, balance, note)
    values
      (p_agency_id, r.staff_id, null, v_boundary, r.leave_type,
       0, 0, v_carried - v_balance, v_carried,
       'carryover ' || extract(year from v_boundary)::int)
    on conflict (agency_id, staff_id, period_start, leave_type) do nothing;

    if found then
      staff_id := r.staff_id;
      leave_type := r.leave_type;
      carried := v_carried;
      forfeited := v_forfeited;
      return next;
    end if;
  end loop;
end;
$$;

-- public.approve_delegation_material(p_assignment_id uuid, p_content jsonb)  (latest definition: 20260914070000_delegation_templates.sql; 1 swap)
create or replace function public.approve_delegation_material(
  p_assignment_id uuid,
  p_content jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mat public.delegation_training_materials%rowtype;
  v_asg public.individual_delegation_assignments%rowtype;
  v_content jsonb;
begin
  select * into v_mat from public.delegation_training_materials where assignment_id = p_assignment_id;
  if v_mat.id is null then
    raise exception 'Training material not found.';
  end if;
  if not private.has_permission(v_mat.agency_id, 'delegation.training.approve') then
    raise exception 'You do not have permission to do that.';
  end if;
  if v_mat.status = 'published' then
    raise exception 'This material is already published.';
  end if;
  select * into v_asg from public.individual_delegation_assignments where id = p_assignment_id;

  v_content := coalesce(p_content, v_mat.draft_content)
    || '{"generatedMark": "Digital record generated by Complyrer."}'::jsonb;

  update public.delegation_training_materials
  set status = 'published',
      draft_content = v_content,
      published_content = v_content,
      approved_at = now(),
      approved_by = auth.uid()
  where id = v_mat.id
  returning * into v_mat;

  -- Publication notifies every staff member at the site, exactly once.
  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  select distinct
    v_mat.agency_id,
    m.user_id,
    'delegation.published',
    'New delegation training to review',
    (v_content ->> 'templateName') || ' for ' || (v_content ->> 'individualName') ||
      ' is published. Review it and sign your acknowledgment.',
    '/delegations/templates',
    'delegation_assignment',
    v_asg.id::text,
    'delegation.published:' || v_asg.id::text || ':' || m.user_id::text
  from public.memberships m
  where m.agency_id = v_mat.agency_id
    and (m.site_id = v_mat.site_id or m.site_id is null)
    and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  on conflict (agency_id, dedupe_key) do nothing;

  return to_jsonb(v_mat);
end;
$$;

-- public.assign_delegation(p_activation_id uuid, p_individual_id uuid)  (latest definition: 20260914070000_delegation_templates.sql; 1 swap)
create or replace function public.assign_delegation(
  p_activation_id uuid,
  p_individual_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_act public.site_delegation_activations%rowtype;
  v_tpl public.delegation_templates%rowtype;
  v_ind public.individuals%rowtype;
  v_site public.sites%rowtype;
  v_assignment public.individual_delegation_assignments%rowtype;
  v_material public.delegation_training_materials%rowtype;
  v_draft jsonb;
begin
  select * into v_act from public.site_delegation_activations where id = p_activation_id;
  if v_act.id is null then
    raise exception 'Delegation activation not found.';
  end if;
  if v_act.status <> 'active' then
    raise exception 'This activation is no longer active.';
  end if;
  if not private.has_permission(v_act.agency_id, 'delegation.assign') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not private.has_site(v_act.agency_id, v_act.site_id) then
    raise exception 'You do not have permission to do that.';
  end if;

  select * into v_ind from public.individuals
  where id = p_individual_id and agency_id = v_act.agency_id;
  if v_ind.id is null then
    raise exception 'Individual not found.';
  end if;
  -- The individual must belong to the activated site.
  if v_ind.site_id <> v_act.site_id then
    raise exception 'The individual does not belong to the activated site.';
  end if;

  select * into v_tpl from public.delegation_templates where id = v_act.template_id;
  select * into v_site from public.sites where id = v_act.site_id;

  insert into public.individual_delegation_assignments
    (agency_id, activation_id, template_id, individual_id, site_id, status, assigned_by)
  values
    (v_act.agency_id, v_act.id, v_tpl.id, v_ind.id, v_site.id, 'assigned', auth.uid())
  returning * into v_assignment;

  -- Instantiate the editable draft from the generic template sections.
  v_draft := jsonb_build_object(
    'templateId', v_tpl.id,
    'templateName', v_tpl.name,
    'individualId', v_ind.id,
    'individualName', v_ind.full_name,
    'siteId', v_site.id,
    'siteName', v_site.name,
    'purpose', v_tpl.sections ->> 'purpose',
    'steps', coalesce(v_tpl.sections -> 'steps', '[]'::jsonb),
    'safetyWarnings', coalesce(v_tpl.sections -> 'safetyWarnings', '[]'::jsonb),
    'documentation', coalesce(v_tpl.sections -> 'documentation', '[]'::jsonb),
    'individualNotes', '',
    'individualizationNote', v_tpl.individualization_note,
    'generatedMark', 'Digital record generated by Complyrer.'
  );

  insert into public.delegation_training_materials
    (agency_id, assignment_id, site_id, status, draft_content)
  values
    (v_act.agency_id, v_assignment.id, v_site.id, 'draft', v_draft)
  returning * into v_material;

  -- Notify reviewers (DPM/RN/admins at the site or agency-wide). Activation
  -- itself notifies nobody; assignment notifies reviewers only.
  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  select distinct
    v_act.agency_id,
    m.user_id,
    'delegation.review_ready',
    'Delegation ready for review',
    v_tpl.name || ' was assigned to ' || v_ind.full_name || ' at ' || v_site.name ||
      '. Review and individualize the training draft.',
    '/delegations/templates',
    'delegation_assignment',
    v_assignment.id::text,
    'delegation.review_ready:' || v_assignment.id::text || ':' || m.user_id::text
  from public.memberships m
  join public.agency_roles ar
    on ar.agency_id = m.agency_id
   and ar.template_key = coalesce(m.role_key, m.role::text)
  where m.agency_id = v_act.agency_id
    and (m.site_id = v_site.id or m.site_id is null)
    and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    and coalesce((ar.permissions ->> 'delegation.training.review')::boolean, false)
  on conflict (agency_id, dedupe_key) do nothing;

  return jsonb_build_object('assignment', to_jsonb(v_assignment), 'material', to_jsonb(v_material));
end;
$$;

-- public.mutate_care_screening(p_agency_id uuid, p_input jsonb)  (latest definition: 20261027121000_care_plans_screening.sql; 2 swaps)
create or replace function public.mutate_care_screening(p_agency_id uuid,p_input jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  action text := p_input->>'action';
  person_id uuid;
  row_id uuid := nullif(p_input->>'id','')::uuid;
  prev_id uuid := nullif(p_input->>'previous_id','')::uuid;
  active_id uuid;
  plan individual_care_plans%rowtype;
  draft jsonb := p_input->'draft';
  item jsonb;
  date_value text;
  old_screen individual_health_screenings%rowtype;
  nurse boolean;
  approver boolean;
begin
  if not private.has_agency(p_agency_id) then raise exception 'Not allowed'; end if;
  nurse := private.role_key_in(p_agency_id,array['nurse']);
  approver := private.role_key_in(p_agency_id,array['nurse','program_manager']);
  if action='type' then
    if not nurse then raise exception 'Only nurses manage screening types'; end if;
    if coalesce(length(trim(p_input->>'name')),0)=0 or (p_input->>'due_soon_days')::integer not between 0 and 365 or p_input->>'due_soon_days' is null then raise exception 'Invalid screening type'; end if;
    if row_id is null then
      insert into health_screening_types(agency_id,name,due_soon_days,enabled) values(p_agency_id,trim(p_input->>'name'),(p_input->>'due_soon_days')::integer,coalesce((p_input->>'enabled')::boolean,true));
    else
      update health_screening_types set name=trim(p_input->>'name'),due_soon_days=(p_input->>'due_soon_days')::integer,enabled=(p_input->>'enabled')::boolean where id=row_id and agency_id=p_agency_id;
      if not found then raise exception 'Screening type not found'; end if;
    end if;
    return;
  end if;
  if action in ('draft','screening') then
    person_id := (p_input->>'individual_id')::uuid;
  else
    select * into plan from individual_care_plans where id=row_id and agency_id=p_agency_id;
    if not found then raise exception 'Care plan not found'; end if;
    person_id := plan.individual_id;
  end if;
  if not coalesce(private.can_read_individual(p_agency_id,person_id),false) then raise exception 'Individual outside your access'; end if;
  -- Lock the Individual first for every plan action, serializing revisions,
  -- approvals and acknowledgements, including concurrent first-plan creation.
  perform 1 from individuals where id=person_id and agency_id=p_agency_id for update;
  if row_id is not null and action not in ('screening','draft') then
    select * into plan from individual_care_plans where id=row_id and agency_id=p_agency_id for update;
  end if;
  if action='draft' then
    if not nurse then raise exception 'Only nurses draft care plans'; end if;
    if coalesce(length(trim(draft->>'title')),0)=0 or jsonb_typeof(draft->'items') is distinct from 'array' then raise exception 'Add a title and care items'; end if;
    if jsonb_array_length(draft->'items')=0 then raise exception 'Add at least one care item'; end if;
    for item in select value from jsonb_array_elements(draft->'items') loop
      if coalesce(length(trim(item->>'need')),0)=0 or coalesce(length(trim(item->>'goal')),0)=0 or coalesce(length(trim(item->>'interventions')),0)=0 or (item->>'review_on') is null then raise exception 'Incomplete care item'; end if;
      if (item->>'review_on') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid review date'; end if;
      perform (item->>'review_on')::date;
      if jsonb_typeof(item->'roles') is distinct from 'array' then raise exception 'Choose responsible roles'; end if;
      if jsonb_array_length(item->'roles')=0 or exists(select 1 from jsonb_array_elements_text(item->'roles') r where r is null or r not in ('nurse','program_manager','house_manager','dsp')) then raise exception 'Invalid responsible roles'; end if;
    end loop;
    select id into active_id from individual_care_plans where individual_id=person_id and status='active';
    if active_id is distinct from prev_id then raise exception 'Revise the current active plan'; end if;
    insert into individual_care_plans(agency_id,individual_id,title,items,previous_id,created_by) values(p_agency_id,person_id,trim(draft->>'title'),draft->'items',prev_id,auth.uid());
  elsif action='approve' then
    if not approver or plan.status<>'draft' then raise exception 'Only nurses or Program Managers approve drafts'; end if;
    select id into active_id from individual_care_plans where individual_id=person_id and status='active';
    if active_id is distinct from plan.previous_id then raise exception 'The active plan changed; create a new revision'; end if;
    update individual_care_plans set status='revised',retired_at=now() where id=active_id;
    update individual_care_plans set status='active',approved_by=auth.uid(),approved_at=now() where id=row_id;
  elsif action='retire' then
    if not nurse or plan.status not in ('active','draft') then raise exception 'Only nurses retire current plans'; end if;
    if plan.status='active' and exists(select 1 from individual_care_plans where individual_id=person_id and status='draft') then raise exception 'Approve or retire the pending draft first'; end if;
    update individual_care_plans set status='retired',retired_at=now() where id=row_id;
  elsif action='acknowledge' then
    if plan.status<>'active' or not private.role_key_in(p_agency_id,array['nurse','program_manager','house_manager','dsp']) then raise exception 'Only supporting staff acknowledge active plans'; end if;
    insert into care_plan_acknowledgements(plan_id,user_id) values(row_id,auth.uid()) on conflict do nothing;
  elsif action='screening' then
    if not nurse then raise exception 'Only nurses manage screenings'; end if;
    if row_id is not null then
      select * into old_screen from individual_health_screenings where id=row_id and agency_id=p_agency_id and individual_id=person_id for update;
      if not found then raise exception 'Screening not found'; end if;
    end if;
    if not exists(select 1 from health_screening_types t where t.id=(draft->>'type_id')::uuid and t.agency_id=p_agency_id and (t.enabled or t.id=old_screen.type_id)) then raise exception 'Choose an enabled screening type'; end if;
    for date_value in select unnest(array[draft->>'due_on',draft->>'last_completed_on',draft->>'completed_on']) loop
      if date_value is not null and date_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use a valid calendar date'; end if;
    end loop;
    if (draft->>'last_completed_on')::date>(now() at time zone 'America/Chicago')::date or (draft->>'completed_on')::date>(now() at time zone 'America/Chicago')::date then raise exception 'Completion cannot be in the future'; end if;
    if row_id is null then
      insert into individual_health_screenings(agency_id,individual_id,type_id,last_completed_on,due_on,completed_on,result_note,follow_up) values(p_agency_id,person_id,(draft->>'type_id')::uuid,(draft->>'last_completed_on')::date,(draft->>'due_on')::date,(draft->>'completed_on')::date,coalesce(draft->>'result_note',''),coalesce(draft->>'follow_up',''));
    else
      update individual_health_screenings set type_id=(draft->>'type_id')::uuid,last_completed_on=(draft->>'last_completed_on')::date,due_on=(draft->>'due_on')::date,completed_on=(draft->>'completed_on')::date,result_note=coalesce(draft->>'result_note',''),follow_up=coalesce(draft->>'follow_up','') where id=row_id;
    end if;
  else raise exception 'Unknown care action'; end if;
end; $$;

-- public.note_kiosk_late_clock_in(p_token text, p_staff_id uuid, p_scheduled_start timestamptz, p_punched_at timestamptz, p_source_key text)  (latest definition: 20261015130000_kiosk_lateness_and_resolved_notices.sql; 1 swap)
create or replace function public.note_kiosk_late_clock_in(
  p_token text,
  p_staff_id uuid,
  p_scheduled_start timestamptz,
  p_punched_at timestamptz,
  p_source_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.hr_kiosk_tokens%rowtype;
  v_minutes integer := 15;
  v_points integer := 1;
  v_source text := left(btrim(coalesce(p_source_key, '')), 200);
  v_notice_id uuid;
begin
  if v_source = '' or p_scheduled_start is null or p_punched_at is null then
    return false;
  end if;

  select * into v_token
  from public.hr_kiosk_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and active
    and revoked_at is null
  limit 1;

  if v_token.id is null then
    raise exception 'invalid kiosk token';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.user_id = p_staff_id
      and m.agency_id = v_token.agency_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  ) then
    return false;
  end if;

  -- The point follows a real kiosk clock-in. A token alone cannot invent one.
  if not exists (
    select 1
    from public.hr_punches p
    where p.agency_id = v_token.agency_id
      and p.site_id = v_token.site_id
      and p.staff_id = p_staff_id
      and p.kind = 'in'
      and p.verification_method = 'kiosk_pin'
      and p.punched_at = p_punched_at
  ) then
    return false;
  end if;

  begin
    v_minutes := greatest(0, coalesce(
      private.rule_number(v_token.agency_id, v_token.site_id, 'accountability.late_clock_in_minutes'),
      15
    )::integer);
    v_points := greatest(1, coalesce(
      private.rule_number(v_token.agency_id, v_token.site_id, 'accountability.points_per_late_item'),
      1
    )::integer);
  exception
    when undefined_function or undefined_table then
      v_minutes := 15;
      v_points := 1;
  end;

  -- On time, or exactly at the saved minutes, is not late.
  if p_punched_at <= p_scheduled_start + make_interval(mins => v_minutes) then
    return false;
  end if;

  insert into public.notifications (
    agency_id, user_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key
  ) values (
    v_token.agency_id,
    p_staff_id,
    null,
    'accountability.warning',
    'Late clock-in',
    format(
      'Clocking in more than %s minutes late costs %s point.',
      v_minutes,
      v_points
    ),
    '/hub',
    'profile',
    v_source,
    v_source
  )
  on conflict (agency_id, dedupe_key) do nothing
  returning id into v_notice_id;

  if v_notice_id is null then
    return false;
  end if;

  insert into public.audit_events (agency_id, actor_id, action, target_type, target_id, detail)
  values (
    v_token.agency_id,
    p_staff_id,
    'accountability.point',
    'profile',
    p_staff_id,
    format('Late clock-in costs %s point. source=%s', v_points, v_source)
  );

  return true;
end;
$$;

-- public.post_open_shift(p_site_id uuid, p_kind text, p_title text, p_starts_at timestamptz, p_ends_at timestamptz, p_days smallint[], p_window_start text, p_window_end text, p_effective_from date, p_notes text, p_slots integer, p_pickup_mode text, p_audience text)  (latest definition: 20260925150000_open_shifts.sql; 1 swap)
create or replace function public.post_open_shift(
  p_site_id uuid,
  p_kind text,
  p_title text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_days smallint[] default '{}',
  p_window_start text default null,
  p_window_end text default null,
  p_effective_from date default null,
  p_notes text default '',
  p_slots integer default 1,
  p_pickup_mode text default 'approval',
  p_audience text default 'site'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_agency uuid;
  v_row hr_open_shifts;
  v_name text;
  v_when text;
begin
  select s.agency_id into v_agency from sites s where s.id = p_site_id;
  if v_agency is null then
    raise exception 'Site not found.' using errcode = 'P0002';
  end if;
  if p_audience = 'agency' then
    if p_kind <> 'permanent' then
      raise exception 'Agency-wide postings are for permanent shifts.' using errcode = 'P0001';
    end if;
    if not (private.has_permission(v_agency, 'hub.manage_staffing')
            and private.role_key_in(v_agency, '{hr,administrator}')) then
      raise exception 'Only HR can post agency-wide openings.' using errcode = '42501';
    end if;
  elsif not private.can_manage_site_schedule(v_agency, p_site_id) then
    raise exception 'You can post open shifts only for sites you manage.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Give the shift a name, e.g. "Evening 2:30–10:30".' using errcode = 'P0001';
  end if;
  if p_kind = 'temporary' and (p_starts_at is null or p_starts_at <= now()) then
    raise exception 'Temporary shifts must start in the future.' using errcode = 'P0001';
  end if;
  if p_kind = 'permanent' and (p_effective_from is null or p_effective_from < (now() at time zone 'America/Chicago')::date) then
    raise exception 'Permanent shifts need a start date today or later.' using errcode = 'P0001';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  insert into hr_open_shifts (agency_id, site_id, kind, audience, title, starts_at, ends_at, days,
                              window_start, window_end, effective_from, weekly_hours, notes, slots,
                              pickup_mode, posted_by, posted_by_name)
  values (v_agency, p_site_id, p_kind, p_audience, trim(p_title),
          case when p_kind = 'temporary' then p_starts_at end,
          case when p_kind = 'temporary' then p_ends_at end,
          case when p_kind = 'permanent' then (select array_agg(distinct d order by d) from unnest(p_days) d) else '{}' end,
          case when p_kind = 'permanent' then p_window_start end,
          case when p_kind = 'permanent' then p_window_end end,
          case when p_kind = 'permanent' then p_effective_from end,
          case when p_kind = 'permanent'
               then round(private.window_minutes(p_window_start, p_window_end) / 60.0
                          * (select count(distinct d) from unnest(p_days) d), 2)
               else 0 end,
          coalesce(p_notes, ''), p_slots,
          case when p_kind = 'permanent' then 'approval' else p_pickup_mode end,
          auth.uid(), coalesce(v_name, ''))
  returning * into v_row;

  v_when := case when v_row.kind = 'temporary' then
      to_char(v_row.starts_at at time zone 'America/Chicago', 'Dy Mon DD, HH12:MI AM') || ' – ' ||
      to_char(v_row.ends_at at time zone 'America/Chicago', 'HH12:MI AM')
    else 'Permanent · ' || v_row.window_start || '–' || v_row.window_end || ' · starts ' ||
      to_char(v_row.effective_from, 'Mon DD') end;
  perform private.notify_open_shift(
    v_row,
    case when v_row.kind = 'permanent' then 'Permanent opening: ' else 'Open shift: ' end || v_row.title,
    v_when || case when v_row.pickup_mode = 'approval' then ' · bid to apply' else ' · first come, first served' end
  );
  return v_row.id;
end;
$$;

-- public.record_prn_dose(p_medication_id uuid, p_pills numeric)  (latest definition: 20261031180000_sim_med_cluster.sql; 1 swap)
create or replace function public.record_prn_dose(p_medication_id uuid, p_pills numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; remaining numeric; staff_name text;
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or m.kind <> 'prn' or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse','dsp']) then
    raise exception 'PRN medication not found or dose access denied.';
  end if;
  if p_pills is null or p_pills::text in ('NaN','Infinity','-Infinity') or p_pills <= 0 then
    raise exception 'Enter how many pills were given.';
  end if;
  if p_pills > m.remaining_pills then
    raise exception 'The dose exceeds the recorded stock. Reconcile the count first.';
  end if;
  remaining := m.remaining_pills - p_pills;
  select full_name into staff_name from profiles where id = auth.uid();
  update medications set remaining_pills = remaining where id = m.id;
  insert into prn_dose_logs(agency_id, medication_id, logged_on, pills_used, remaining_after, logged_by, logged_by_user_id)
    values(m.agency_id, m.id, (now() at time zone 'America/Chicago')::date, p_pills, remaining, coalesce(staff_name, ''), auth.uid());
  insert into audit_events(agency_id, actor_id, action, target_type, target_id, detail)
    values(m.agency_id, auth.uid(), 'medication.prn', 'medication', m.id, 'Recorded PRN dose: ' || p_pills::text);
end $$;

-- public.record_prn_dose(p_medication_id uuid, p_pills numeric, p_reason text, p_follow_up text)  (latest definition: 20261031240000_med_admin_clearance_gate.sql; 1 swap)
create or replace function public.record_prn_dose(p_medication_id uuid, p_pills numeric, p_reason text, p_follow_up text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m medications%rowtype; remaining numeric; staff_name text; why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into m from medications where id = p_medication_id for update;
  if m.id is null or m.kind <> 'prn' or not private.can_read_individual(m.agency_id, m.individual_id)
    or not private.role_key_in(m.agency_id, array['administrator','house_manager','degreed_professional_manager','nurse','dsp']) then
    raise exception 'PRN medication not found or dose access denied.';
  end if;
  if private.role_key_in(m.agency_id, array['dsp'])
    and not private.med_admin_cleared(m.agency_id, auth.uid()) then
    raise exception 'Medication actions unlock when your training is cleared.';
  end if;
  if why is null then
    raise exception 'Say why the PRN was given.';
  end if;
  if p_pills is null or p_pills::text in ('NaN','Infinity','-Infinity') or p_pills <= 0 then
    raise exception 'Enter how many pills were given.';
  end if;
  if p_pills > m.remaining_pills then
    if m.last_delivery_on is null and not exists (select 1 from medication_deliveries d where d.medication_id = m.id) then
      if private.role_key_in(m.agency_id, array['dsp']) then
        raise exception 'No count has been recorded for this medication yet. Ask your house manager, RN, or PM to record the first count.';
      end if;
      raise exception 'No count has been recorded for this medication yet. Record the first count before logging a dose.';
    end if;
    if private.role_key_in(m.agency_id, array['dsp']) then
      raise exception 'The dose exceeds the recorded stock. Ask your house manager, RN, or PM to record the count first.';
    end if;
    raise exception 'The dose exceeds the recorded stock. Reconcile the count first.';
  end if;
  remaining := m.remaining_pills - p_pills;
  select full_name into staff_name from profiles where id = auth.uid();
  update medications set remaining_pills = remaining where id = m.id;
  insert into prn_dose_logs(agency_id, medication_id, logged_on, pills_used, remaining_after, logged_by, logged_by_user_id, reason, follow_up)
    values(m.agency_id, m.id, (now() at time zone 'America/Chicago')::date, p_pills, remaining, coalesce(staff_name, ''), auth.uid(), why, nullif(btrim(coalesce(p_follow_up, '')), ''));
  insert into audit_events(agency_id, actor_id, action, target_type, target_id, detail)
    values(m.agency_id, auth.uid(), 'medication.prn', 'medication', m.id, 'Recorded PRN dose: ' || p_pills::text || ' — ' || why);
end $$;

-- public.resolve_missing_note_notices(p_individual_id uuid, p_note_date date, p_block text)  (latest definition: 20261015130000_kiosk_lateness_and_resolved_notices.sql; 1 swap)
create or replace function public.resolve_missing_note_notices(
  p_individual_id uuid,
  p_note_date date,
  p_block text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency uuid;
  v_cleared integer;
begin
  if auth.uid() is null then
    raise exception 'Not allowed';
  end if;
  if p_block not in ('day', 'evening', 'overnight') then
    return 0;
  end if;

  select i.agency_id into v_agency
  from public.individuals i
  where i.id = p_individual_id;

  if v_agency is null or not private.has_agency(v_agency) then
    raise exception 'Not allowed';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = v_agency
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and coalesce(m.role_key, m.role::text) in (
        'administrator', 'program_manager', 'house_manager', 'nurse', 'dsp'
      )
  ) then
    raise exception 'Not allowed';
  end if;

  update public.notifications
  set read_at = now()
  where agency_id = v_agency
    and type = 'documentation.missing_note'
    and read_at is null
    and dedupe_key like (
      'documentation.missing_note:sn:'
      || to_char(p_note_date, 'YYYY-MM-DD')
      || ':'
      || p_individual_id::text
      || ':'
      || p_block
      || ':%'
    );

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

-- public.retire_stale_consent_notices(p_agency_id uuid, p_individual_id uuid)  (latest definition: 20261031220000_retire_stale_consent_notices.sql; 2 swaps)
create or replace function public.retire_stale_consent_notices(
  p_agency_id uuid,
  p_individual_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    if auth.uid() is null or not private.has_agency(p_agency_id) then
      raise exception 'Not allowed';
    end if;
    if not exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
        and coalesce(m.role_key, m.role::text) in (
          'administrator', 'program_manager', 'house_manager', 'nurse'
        )
    ) then
      raise exception 'Not allowed';
    end if;
  end if;

  -- A mismatched agency / Individual pair is refused, never a partial
  -- retire: consent notices are only ever retired inside their own
  -- agency, for the Individual they are actually about.
  if not exists (
    select 1
    from public.individuals i
    where i.id = p_individual_id
      and i.agency_id = p_agency_id
  ) then
    raise exception 'Not allowed';
  end if;

  update public.notifications n
  set read_at = now()
  where n.agency_id = p_agency_id
    and n.read_at is null
    and n.type in ('consent.missing', 'consent.expiring', 'consent.packet_outstanding')
    -- Rights-packet exemption (guards 1 and 2 above).
    and coalesce(n.entity_type, '') <> 'rights_packet'
    and coalesce(n.dedupe_key, '') not like 'rights.%'
    -- Rights-packet exemption (guard 3 above).
    and not exists (
      select 1
      from public.rights_packets rp
      where rp.id::text = n.entity_id
        and rp.agency_id = p_agency_id
        and rp.individual_id = p_individual_id
    )
    and (
      -- Consent-register rows: retire per consent type, and only when
      -- a current consent for this Individual + type now covers them.
      (
        n.entity_type = 'consent'
        and n.type in ('consent.missing', 'consent.expiring')
        and exists (
          select 1
          from public.individual_consents c
          where c.agency_id = p_agency_id
            and c.individual_id = p_individual_id
            and c.type_id = coalesce(
              (
                select linked.type_id
                from public.individual_consents linked
                where linked.id::text = n.entity_id
                  and linked.agency_id = p_agency_id
                  and linked.individual_id = p_individual_id
              ),
              case
                when n.entity_id like p_individual_id::text || ':%'
                  then split_part(n.entity_id, ':', 2)
              end
            )
            and private.consent_current(c.id)
            and (
              n.type = 'consent.missing'
              or (c.details ->> 'reviewOn')::date > (now() at time zone 'America/Chicago')::date + 30
            )
        )
      )
      or
      -- Consent-packet rows: retire only when the packet that raised
      -- the alert has left 'sent' (signed/filed — see header).
      (
        n.entity_type = 'consent_packet'
        and n.type = 'consent.packet_outstanding'
        and exists (
          select 1
          from public.consent_packets cp
          where cp.id::text = n.entity_id
            and cp.agency_id = p_agency_id
            and cp.individual_id = p_individual_id
            and cp.status <> 'sent'
        )
      )
    );

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

-- public.retire_stale_missing_note_notices(p_agency_id uuid, p_service_date date, p_individual_ids uuid[], p_live_ids text[])  (latest definition: 20261025120000_shift_note_scheduled_shift.sql; 1 swap)
create or replace function public.retire_stale_missing_note_notices(
  p_agency_id uuid,
  p_service_date date,
  p_individual_ids uuid[],
  p_live_ids text[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cleared integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    if auth.uid() is null or not private.has_agency(p_agency_id) then
      raise exception 'Not allowed';
    end if;
    if not exists (
      select 1
      from public.memberships m
      where m.user_id = auth.uid()
        and m.agency_id = p_agency_id
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
        and coalesce(m.role_key, m.role::text) in (
          'administrator', 'program_manager', 'house_manager', 'nurse', 'dsp'
        )
    ) then
      raise exception 'Not allowed';
    end if;
  end if;

  update public.notifications n
  set read_at = now()
  where n.agency_id = p_agency_id
    and n.type = 'documentation.missing_note'
    and n.read_at is null
    and n.dedupe_key like 'documentation.missing_note:sn:' || to_char(p_service_date, 'YYYY-MM-DD') || ':%'
    and exists (
      select 1
      from unnest(coalesce(p_individual_ids, array[]::uuid[])) as person(id)
      where n.dedupe_key like
        'documentation.missing_note:sn:'
        || to_char(p_service_date, 'YYYY-MM-DD')
        || ':'
        || person.id::text
        || ':%'
    )
    and not exists (
      select 1
      from unnest(coalesce(p_live_ids, array[]::text[])) as live(id)
      where n.dedupe_key like 'documentation.missing_note:' || live.id || ':%'
    );

  get diagnostics v_cleared = row_count;
  return v_cleared;
end;
$$;

-- public.save_consent_types(p_agency_id uuid, p_types jsonb)  (latest definition: 20261027140000_consents_register.sql; 1 swap)
create or replace function public.save_consent_types(p_agency_id uuid,p_types jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not private.has_agency(p_agency_id) or not exists(select 1 from public.memberships where agency_id=p_agency_id and user_id=auth.uid() and role_key='program_manager' and site_id is null and (expires_on is null or expires_on>=(now() at time zone 'America/Chicago')::date)) then raise exception 'An agency-wide Program Manager configures consent types.' using errcode='42501'; end if;
 if jsonb_typeof(p_types)<>'array' or jsonb_array_length(p_types) not between 1 and 50 then raise exception 'Use up to 50 consent types.'; end if;
 if exists(select 1 from jsonb_array_elements(p_types) t where coalesce(t->>'id','') !~ '^[a-z][a-z0-9_-]{0,49}$' or length(trim(coalesce(t->>'label','')))=0 or jsonb_typeof(t->'required') is distinct from 'boolean' or jsonb_typeof(t->'medication') is distinct from 'boolean') or
 (select count(*) from jsonb_array_elements(p_types))<>(select count(distinct t->>'id') from jsonb_array_elements(p_types) t) then raise exception 'Use unique consent type keys and nonempty labels.'; end if;
 if not exists(select 1 from jsonb_array_elements(p_types) t where t->>'id'='medication' and t->'medication'='true'::jsonb) then raise exception 'Keep the medication administration consent type.'; end if;
 if exists(select 1 from jsonb_array_elements(private.consent_types(p_agency_id)) t where exists(select 1 from public.individual_consents c where c.agency_id=p_agency_id and c.type_id=t->>'id') and not exists(select 1 from jsonb_array_elements(p_types) n where n->>'id'=t->>'id' and n->'medication'=t->'medication')) then raise exception 'Keep types referenced by consent history and their medication classification.'; end if;
 insert into public.consent_type_settings(agency_id,types,updated_by) values(p_agency_id,p_types,auth.uid()) on conflict(agency_id) do update set types=excluded.types,updated_by=excluded.updated_by;
end;
$$;

-- public.submit_dsp_hm_rating(p_hm_id uuid, p_rating smallint)  (latest definition: 20260914060000_recognition.sql; 2 swaps)
create or replace function public.submit_dsp_hm_rating(p_hm_id uuid, p_rating smallint)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user uuid := auth.uid();
  v_agency uuid;
  v_now timestamptz := now();
  v_row_id uuid;
  v_old smallint;
  v_history_id uuid;
  v_dsp_name text;
  v_label text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be a whole number from 1 to 5.';
  end if;
  if p_hm_id = v_user then
    raise exception 'You cannot rate yourself.';
  end if;
  select m.agency_id into v_agency
    from public.memberships m
    where m.user_id = v_user
      and m.role_key = 'dsp'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    limit 1;
  if v_agency is null then
    raise exception 'Only direct support professionals rate house managers.';
  end if;
  if not private.has_permission(v_agency, 'recognition.rate_hm') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.agency_id = v_agency
      and m.user_id = p_hm_id
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  ) then
    raise exception 'That house manager was not found.';
  end if;
  if not private.share_active_site(v_agency, v_user, p_hm_id) then
    raise exception 'You can only rate the house manager of your assigned site.';
  end if;

  select id, rating into v_row_id, v_old
    from public.dsp_hm_ratings
    where agency_id = v_agency and dsp_id = v_user and hm_id = p_hm_id;

  if v_row_id is not null and v_old = p_rating then
    return jsonb_build_object('changed', false, 'rating', v_old, 'history_id', null);
  end if;

  if v_row_id is null then
    insert into public.dsp_hm_ratings (agency_id, dsp_id, hm_id, rating, updated_at)
      values (v_agency, v_user, p_hm_id, p_rating, v_now)
      returning id into v_row_id;
  else
    update public.dsp_hm_ratings
      set rating = p_rating, updated_at = v_now
      where id = v_row_id;
  end if;

  -- The AFTER trigger appended exactly one history row for this change.
  select h.id into v_history_id
    from public.dsp_hm_rating_history h
    where h.rating_id = v_row_id and h.created_at >= v_now
    order by h.created_at desc
    limit 1;

  select p.full_name into v_dsp_name from public.profiles p where p.id = v_user;
  v_label := case p_rating
    when 1 then 'Needs support' when 2 then 'Developing' when 3 then 'Solid'
    when 4 then 'Strong' else 'Exceptional' end;

  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  values
    (v_agency, p_hm_id, 'rating.changed',
     'Your rating was updated',
     coalesce(v_dsp_name, 'A team member') || ' updated their rating of you to ' ||
       p_rating || ' of 5 (' || v_label || ').',
     '/recognition', 'dsp_hm_rating', v_row_id::text,
     'rating.changed:' || coalesce(v_history_id::text, v_row_id::text));

  return jsonb_build_object('changed', true, 'rating', p_rating, 'history_id', v_history_id);
end;
$$;

-- public.submit_hm_dsp_review(p_dsp_id uuid, p_rating smallint)  (latest definition: 20260914060000_recognition.sql; 2 swaps)
create or replace function public.submit_hm_dsp_review(p_dsp_id uuid, p_rating smallint)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user uuid := auth.uid();
  v_agency uuid;
  v_now timestamptz := now();
  v_row_id uuid;
  v_old smallint;
  v_history_id uuid;
  v_hm_name text;
  v_label text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be a whole number from 1 to 5.';
  end if;
  if p_dsp_id = v_user then
    raise exception 'You cannot review yourself.';
  end if;
  select m.agency_id into v_agency
    from public.memberships m
    where m.user_id = v_user
      and m.role_key = 'house_manager'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    limit 1;
  if v_agency is null then
    raise exception 'Only house managers review DSPs.';
  end if;
  if not private.has_permission(v_agency, 'recognition.review_dsp') then
    raise exception 'You do not have permission to do that.';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.agency_id = v_agency
      and m.user_id = p_dsp_id
      and m.role_key = 'dsp'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  ) then
    raise exception 'That DSP was not found.';
  end if;
  if not private.share_active_site(v_agency, v_user, p_dsp_id) then
    raise exception 'You can only review DSPs at your assigned site.';
  end if;

  select id, rating into v_row_id, v_old
    from public.hm_dsp_reviews
    where agency_id = v_agency and hm_id = v_user and dsp_id = p_dsp_id;

  if v_row_id is not null and v_old = p_rating then
    return jsonb_build_object('changed', false, 'rating', v_old, 'history_id', null);
  end if;

  if v_row_id is null then
    insert into public.hm_dsp_reviews (agency_id, hm_id, dsp_id, rating, updated_at)
      values (v_agency, v_user, p_dsp_id, p_rating, v_now)
      returning id into v_row_id;
  else
    update public.hm_dsp_reviews
      set rating = p_rating, updated_at = v_now
      where id = v_row_id;
  end if;

  select h.id into v_history_id
    from public.hm_dsp_review_history h
    where h.review_id = v_row_id and h.created_at >= v_now
    order by h.created_at desc
    limit 1;

  select p.full_name into v_hm_name from public.profiles p where p.id = v_user;
  v_label := case p_rating
    when 1 then 'Needs support' when 2 then 'Developing' when 3 then 'Solid'
    when 4 then 'Strong' else 'Exceptional' end;

  insert into public.notifications
    (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
  values
    (v_agency, p_dsp_id, 'review.changed',
     'Your review was updated',
     coalesce(v_hm_name, 'Your house manager') || ' updated their review of you to ' ||
       p_rating || ' of 5 (' || v_label || ').',
     '/recognition', 'hm_dsp_review', v_row_id::text,
     'review.changed:' || coalesce(v_history_id::text, v_row_id::text));

  return jsonb_build_object('changed', true, 'rating', p_rating, 'history_id', v_history_id);
end;
$$;

-- public.sweep_care_screening(p_agency_id uuid)  (latest definition: 20261027121000_care_plans_screening.sql; 4 swaps)
create or replace function public.sweep_care_screening(p_agency_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare queued integer;
begin
  if auth.role() is distinct from 'service_role' and not private.has_agency(p_agency_id) then raise exception 'Not allowed'; end if;
  with deadlines as (
    select p.id,p.individual_id,'care.review_overdue'::text as type,'Care plan review overdue'::text as title,min((j->>'review_on')::date) as due_on
    from individual_care_plans p cross join lateral jsonb_array_elements(p.items) j
    where p.agency_id=p_agency_id and p.status='active'
    group by p.id,p.individual_id having min((j->>'review_on')::date)<(now() at time zone 'America/Chicago')::date
    union all
    select s.id,s.individual_id,case when s.due_on<(now() at time zone 'America/Chicago')::date then 'screening.overdue' else 'screening.due_soon' end,
      'Health screening: '||t.name,s.due_on
    from individual_health_screenings s join health_screening_types t on t.id=s.type_id
    where s.agency_id=p_agency_id and s.completed_on is null and s.due_on<=(now() at time zone 'America/Chicago')::date+t.due_soon_days
  )
  insert into notifications(agency_id,user_id,type,title,body,deep_link,entity_type,entity_id,dedupe_key)
  select p_agency_id,m.user_id,d.type,d.title,i.full_name||': due '||d.due_on::text,
    '/plans/'||i.id::text||'#chart-care-plans','individual',i.id::text,d.type||':'||d.id::text||':'||d.due_on::text||':'||m.user_id::text
  from deadlines d join individuals i on i.id=d.individual_id and i.agency_id=p_agency_id
  join memberships m on m.agency_id=p_agency_id
    and (m.expires_on is null or m.expires_on>=(now() at time zone 'America/Chicago')::date)
    and ((m.role_key in ('nurse','house_manager') and m.site_id=i.site_id)
      or (m.role_key='program_manager' and d.type<>'care.review_overdue'))
  join profiles recipient on recipient.id=m.user_id and recipient.active and not recipient.must_change_password
  join agencies agency on agency.id=m.agency_id and agency.active and agency.status='active'
  where (auth.role()='service_role' or private.can_read_individual(p_agency_id,i.id))
    and (auth.role()='service_role' or private.has_agency(p_agency_id))
  on conflict(agency_id,dedupe_key) do nothing;
  get diagnostics queued = row_count;
  return queued;
end; $$;

-- public.sweep_delegation_ack_overdue()  (latest definition: 20260914070000_delegation_templates.sql; 3 swaps)
create or replace function public.sweep_delegation_ack_overdue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_added integer;
begin
  -- 1) Staff reminders: one per overdue (assignment, staff).
  with overdue as (
    select distinct
      m.agency_id,
      m.assignment_id,
      m.site_id,
      m.approved_at,
      (m.published_content ->> 'templateName') as template_name,
      (m.published_content ->> 'individualName') as individual_name,
      mem.user_id
    from public.delegation_training_materials m
    join public.individual_delegation_assignments a
      on a.id = m.assignment_id and a.status = 'assigned'
    join public.memberships mem
      on mem.agency_id = m.agency_id
     and (mem.site_id = m.site_id or mem.site_id is null)
     and (mem.expires_on is null or mem.expires_on >= (now() at time zone 'America/Chicago')::date)
    left join public.delegation_acknowledgments ack
      on ack.assignment_id = m.assignment_id
     and ack.staff_id = mem.user_id
     and ack.signed_at is not null
    where m.status = 'published'
      and m.approved_at < now() - interval '7 days'
      and ack.id is null
  ),
  ins as (
    insert into public.notifications
      (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    select
      agency_id,
      user_id,
      'delegation.ack_overdue',
      'Delegation acknowledgment overdue',
      template_name || ' for ' || individual_name ||
        ' was published ' || extract(day from (now() - approved_at))::int ||
        ' days ago. Review it and sign your acknowledgment.',
      '/delegations/templates',
      'delegation_assignment',
      assignment_id::text,
      'delegation.ack_overdue:' || assignment_id::text || ':' || user_id::text
    from overdue
    on conflict (agency_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_added from ins;
  v_count := v_count + v_added;

  -- 2) Manager summaries: one per overdue assignment per manager
  --    (delegation.activate holders at the site or agency-wide).
  with overdue_assignments as (
    select distinct
      m.agency_id, m.assignment_id, m.site_id,
      (m.published_content ->> 'templateName') as template_name,
      (m.published_content ->> 'individualName') as individual_name,
      count(*) filter (
        where ack.id is null
      ) over (partition by m.assignment_id) as outstanding
    from public.delegation_training_materials m
    join public.individual_delegation_assignments a
      on a.id = m.assignment_id and a.status = 'assigned'
    join public.memberships mem
      on mem.agency_id = m.agency_id
     and (mem.site_id = m.site_id or mem.site_id is null)
     and (mem.expires_on is null or mem.expires_on >= (now() at time zone 'America/Chicago')::date)
    left join public.delegation_acknowledgments ack
      on ack.assignment_id = m.assignment_id
     and ack.staff_id = mem.user_id
     and ack.signed_at is not null
    where m.status = 'published'
      and m.approved_at < now() - interval '7 days'
  ),
  managers as (
    select distinct
      oa.agency_id, oa.assignment_id, oa.template_name, oa.individual_name,
      oa.outstanding, mem.user_id
    from overdue_assignments oa
    join public.memberships mem
      on mem.agency_id = oa.agency_id
     and (mem.site_id = oa.site_id or mem.site_id is null)
     and (mem.expires_on is null or mem.expires_on >= (now() at time zone 'America/Chicago')::date)
    join public.agency_roles ar
      on ar.agency_id = mem.agency_id
     and ar.template_key = coalesce(mem.role_key, mem.role::text)
    where coalesce((ar.permissions ->> 'delegation.activate')::boolean, false)
  ),
  ins2 as (
    insert into public.notifications
      (agency_id, user_id, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    select
      agency_id,
      user_id,
      'delegation.ack_overdue',
      'Delegation acknowledgments overdue',
      outstanding::int || ' staff still need to sign ' || template_name ||
        ' for ' || individual_name || '.',
      '/delegations/templates',
      'delegation_assignment',
      assignment_id::text,
      'delegation.ack_overdue:mgr:' || assignment_id::text || ':' || user_id::text
    from managers
    on conflict (agency_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_added from ins2;
  v_count := v_count + v_added;

  return v_count;
end;
$$;

-- public.sweep_qa_schedule_reminders()  (latest definition: 20260915026000_qa_workflow_repairs.sql; 1 swap)
create or replace function public.sweep_qa_schedule_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_today date := (now() at time zone 'America/Chicago')::date;
  r record;
begin
  for r in
    select s.*, site.name as site_name
    from public.qa_schedules s
    join public.sites site on site.id = s.site_id
    where s.active
      and s.next_due <= v_today + 14
  loop
    if not private.has_permission(r.agency_id, 'qa.schedule') or not private.can_read_site(r.agency_id, r.site_id) then
      continue;
    end if;
    insert into public.notifications
      (agency_id, role_key, type, title, body, deep_link, entity_type, entity_id, dedupe_key)
    values
      (r.agency_id,
       'auditor',
       case when r.next_due < v_today then 'qa.schedule_overdue' else 'qa.schedule_due' end,
       case when r.next_due < v_today then 'QA audit overdue' else 'QA audit due soon' end,
       r.site_name || ' — quarterly QA audit ' ||
         case when r.next_due < v_today then 'was due ' else 'is due ' end || r.next_due::text || '.',
       '/qa-audits?siteId=' || r.site_id::text,
       'qa_schedule',
       r.id::text,
       'qa.schedule:' || r.id::text || ':' || v_today::text)
    on conflict do nothing;
  end loop;
  -- Recompute the true count of today's reminders for the caller's own
  -- agencies (the sweep iterates every agency, but the caller only ever
  -- sees their own).
  select count(*) into v_count
  from public.notifications n
  where n.dedupe_key like 'qa.schedule:%:' || v_today::text
    and n.created_at::date = v_today
    and private.has_permission(n.agency_id, 'qa.schedule');
  return v_count;
end;
$$;

-- public.sync_packet_roster(p_packet_id uuid)  (latest definition: 20260912020000_complyrer_access.sql; 3 swaps)
create or replace function public.sync_packet_roster(p_packet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pkt public.acknowledgment_packets%rowtype;
  person public.individuals%rowtype;
begin
  select * into pkt
  from public.acknowledgment_packets
  where id = p_packet_id;
  if not found then
    raise exception 'Acknowledgment packet not found.';
  end if;
  if not (
    private.can_approve(pkt.agency_id)
    or private.can_upload(pkt.agency_id)
  ) then
    raise exception 'You do not have permission to do that.';
  end if;
  select * into person from public.individuals where id = pkt.individual_id;

  insert into public.acknowledgment_rows (
    agency_id, packet_id, user_id, staff_name
  )
  select
    pkt.agency_id,
    pkt.id,
    a.user_id,
    p.full_name
  from public.staff_assignments a
  join public.profiles p on p.id = a.user_id
  where a.agency_id = pkt.agency_id
    and a.individual_id = pkt.individual_id
    and a.starts_on <= (now() at time zone 'America/Chicago')::date
    and (a.ends_on is null or a.ends_on >= (now() at time zone 'America/Chicago')::date)
  on conflict (packet_id, user_id) do nothing;

  insert into public.acknowledgment_rows (
    agency_id, packet_id, user_id, staff_name
  )
  select
    pkt.agency_id,
    pkt.id,
    m.user_id,
    p.full_name
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.agency_id = pkt.agency_id
    and coalesce(m.role_key, m.role::text) in (
      'house_manager',
      'degreed_professional_manager',
      'program_manager'
    )
    and (m.site_id is null or m.site_id = person.site_id)
    and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  on conflict (packet_id, user_id) do nothing;
end;
$$;

-- public.update_delegation_template(p_template_id uuid, p_name text, p_category text, p_active boolean)  (latest definition: 20260914070000_delegation_templates.sql; 1 swap)
create or replace function public.update_delegation_template(
  p_template_id uuid,
  p_name text default null,
  p_category text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl public.delegation_templates%rowtype;
begin
  select * into v_tpl from public.delegation_templates where id = p_template_id;
  if v_tpl.id is null then
    raise exception 'Delegation template not found.';
  end if;
  if v_tpl.agency_id is null then
    -- Common-library template: editable by a caller holding
    -- delegation.templates.manage in any of their agencies (local-API parity:
    -- the local client also allows editing the shared library).
    if not exists (
      select 1
      from public.memberships m
      join public.agency_roles ar
        on ar.agency_id = m.agency_id
       and ar.template_key = coalesce(m.role_key, m.role::text)
      where m.user_id = auth.uid()
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
        and coalesce((ar.permissions ->> 'delegation.templates.manage')::boolean, false)
    ) then
      raise exception 'You do not have permission to do that.';
    end if;
  elsif not private.has_permission(v_tpl.agency_id, 'delegation.templates.manage') then
    raise exception 'You do not have permission to do that.';
  end if;

  update public.delegation_templates
  set name = coalesce(p_name, name),
      category = coalesce(p_category, category),
      active = coalesce(p_active, active),
      updated_at = now()
  where id = v_tpl.id
  returning * into v_tpl;

  -- A single JSON object (not an array).
  return to_jsonb(v_tpl);
end;
$$;

-- ---------------------------------------------------------------------
-- RLS policies: latest definitions, Central-day calendar.
-- ---------------------------------------------------------------------

-- delegation_acknowledgments_select on public.delegation_acknowledgments  (latest definition: 20260914070000_delegation_templates.sql; 1 swap)
drop policy if exists delegation_acknowledgments_select on public.delegation_acknowledgments;
create policy delegation_acknowledgments_select on public.delegation_acknowledgments
for select to authenticated
using (
  staff_id = auth.uid()
  or (select private.has_permission(agency_id, 'delegation.training.review'))
  or (select private.has_permission(agency_id, 'delegation.training.approve'))
  or (select private.has_permission(agency_id, 'delegation.activate'))
  or exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.agency_id = delegation_acknowledgments.agency_id
      and m.site_id = delegation_acknowledgments.site_id
      and coalesce(m.role_key, m.role::text) = 'house_manager'
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
  )
);

-- dsp_hm_ratings_update on public.dsp_hm_ratings  (latest definition: 20260914060000_recognition.sql; 2 swaps)
drop policy if exists dsp_hm_ratings_update on public.dsp_hm_ratings;
create policy dsp_hm_ratings_update on public.dsp_hm_ratings
  for update using (
    dsp_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.rate_hm'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = dsp_hm_ratings.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'dsp'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
  ) with check (
    dsp_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.rate_hm'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = dsp_hm_ratings.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'dsp'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), hm_id))
  );

-- dsp_hm_ratings_write on public.dsp_hm_ratings  (latest definition: 20260914060000_recognition.sql; 1 swap)
drop policy if exists dsp_hm_ratings_write on public.dsp_hm_ratings;
create policy dsp_hm_ratings_write on public.dsp_hm_ratings
  for insert with check (
    dsp_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.rate_hm'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = dsp_hm_ratings.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'dsp'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), hm_id))
  );

-- hm_dsp_reviews_update on public.hm_dsp_reviews  (latest definition: 20260914060000_recognition.sql; 2 swaps)
drop policy if exists hm_dsp_reviews_update on public.hm_dsp_reviews;
create policy hm_dsp_reviews_update on public.hm_dsp_reviews
  for update using (
    hm_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.review_dsp'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = hm_dsp_reviews.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'house_manager'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
  ) with check (
    hm_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.review_dsp'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = hm_dsp_reviews.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'house_manager'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), dsp_id))
  );

-- hm_dsp_reviews_write on public.hm_dsp_reviews  (latest definition: 20260914060000_recognition.sql; 1 swap)
drop policy if exists hm_dsp_reviews_write on public.hm_dsp_reviews;
create policy hm_dsp_reviews_write on public.hm_dsp_reviews
  for insert with check (
    hm_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.review_dsp'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = hm_dsp_reviews.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'house_manager'
        and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), dsp_id))
  );

-- message_participants_insert on public.message_participants  (latest definition: 20261027151000_internal_messaging.sql; 1 swap)
drop policy if exists message_participants_insert on public.message_participants;
create policy message_participants_insert on public.message_participants
for insert to authenticated
with check (
  (select private.can_use_messaging(agency_id))
  and (
    (user_id = (select auth.uid()) and added_by is null)
    or added_by = (select auth.uid())
  )
  and (select private.thread_in_agency(thread_id, agency_id))
  and (
    -- Seeding: the caller created this thread and it has no messages yet.
    (
      (select private.thread_created_by_caller(thread_id))
      and not (select private.thread_has_messages(thread_id))
    )
    -- Adding: the caller already belongs to the thread.
    or (select private.is_thread_participant(thread_id))
  )
  and exists (
    select 1
    from public.memberships tm
    join public.agency_roles ar
      on ar.agency_id = tm.agency_id
     and ar.template_key = coalesce(tm.role_key, tm.role::text)
    where tm.user_id = message_participants.user_id
      and tm.agency_id = message_participants.agency_id
      and (tm.expires_on is null or tm.expires_on >= (now() at time zone 'America/Chicago')::date)
      and coalesce(tm.role_key, tm.role::text) in (
        'administrator', 'compliance_admin', 'program_manager',
        'house_manager', 'nurse', 'dsp', 'hr'
      )
      and coalesce((ar.permissions ->> 'messages.use')::boolean, false)
  )
);

-- notification_reads_insert on public.notification_reads  (latest definition: 20260914010000_notifications.sql; 1 swap)
drop policy if exists notification_reads_insert on public.notification_reads;
create policy notification_reads_insert on public.notification_reads
for insert to authenticated
with check (
  notification_reads.user_id = auth.uid()
  and exists (
    select 1
    from public.notifications n
    where n.id = notification_reads.notification_id
      and (select private.has_agency(n.agency_id))
      and (
        n.user_id = auth.uid()
        or (
          n.role_key is not null
          and exists (
            select 1
            from public.memberships m
            where m.user_id = auth.uid()
              and m.agency_id = n.agency_id
              and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
              and coalesce(m.role_key, m.role::text) = n.role_key
          )
        )
      )
  )
);

-- notifications_select on public.notifications  (latest definition: 20260914010000_notifications.sql; 1 swap)
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using (
  (select private.has_agency(notifications.agency_id))
  and (
    notifications.user_id = auth.uid()
    or (
      notifications.role_key is not null
      and exists (
        select 1
        from public.memberships m
        where m.user_id = auth.uid()
          and m.agency_id = notifications.agency_id
          and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
          and coalesce(m.role_key, m.role::text) = notifications.role_key
      )
    )
  )
);

-- rights_packets_complete on public.rights_packets  (latest definition: 20261030170000_rights_packets.sql; 1 swap)
drop policy if exists rights_packets_complete on public.rights_packets;
create policy rights_packets_complete on public.rights_packets for update to authenticated using (
 private.can_manage_consent(agency_id, individual_id) and status = 'awaiting_signature' and signed_at is null)
 with check (
 private.can_manage_consent(agency_id, individual_id) and status in ('signed','filed') and packet_on is not null and packet_on <= (now() at time zone 'America/Chicago')::date and signer is not null);

-- signature_audit_log_select_verifier on public.signature_audit_log  (latest definition: 20260913230000_esignature_hardening.sql; 1 swap)
drop policy if exists signature_audit_log_select_verifier on public.signature_audit_log;
create policy signature_audit_log_select_verifier on public.signature_audit_log
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = signature_audit_log.user_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

-- signature_events_select_verifier on public.signature_events  (latest definition: 20260913200000_esignature_capture.sql; 1 swap)
drop policy if exists signature_events_select_verifier on public.signature_events;
create policy signature_events_select_verifier on public.signature_events
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = signature_events.signer_user_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

-- user_signatures_select_verifier on public.user_signatures  (latest definition: 20260913200000_esignature_capture.sql; 1 swap)
drop policy if exists user_signatures_select_verifier on public.user_signatures;
create policy user_signatures_select_verifier on public.user_signatures
for select to authenticated
using (
  exists (
    select 1
    from public.memberships m
    where m.user_id = user_signatures.user_id
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

-- user_signatures_storage_select_verifier on storage.objects  (latest definition: 20260913200000_esignature_capture.sql; 1 swap)
drop policy if exists user_signatures_storage_select_verifier on storage.objects;
create policy user_signatures_storage_select_verifier on storage.objects
for select to authenticated
using (
  bucket_id = 'user-signatures'
  and exists (
    select 1
    from public.memberships m
    where m.user_id::text = (storage.foldername(name))[1]
      and (m.expires_on is null or m.expires_on >= (now() at time zone 'America/Chicago')::date)
      and (select private.role_key_in(m.agency_id, '{administrator,compliance_admin}'))
  )
);

commit;
