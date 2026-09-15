-- Defense in depth: restrictive policies also constrain older permissive
-- FOR ALL policies (which otherwise grant unintended SELECT/INSERT access).
create or replace function private.has_agency(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    join profiles p on p.id = m.user_id
    join agencies a on a.id = m.agency_id
    where m.user_id = auth.uid() and m.agency_id = p_agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
      and p.active and not p.must_change_password and a.active and a.status = 'active'
  );
$$;

create or replace function private.can_read_site(p_agency_id uuid, p_site_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_agency(p_agency_id) and exists (
    select 1 from memberships m join sites s on s.agency_id = m.agency_id
    where m.user_id = auth.uid() and m.agency_id = p_agency_id and s.id = p_site_id
      and (
        m.role_key in ('administrator','compliance_admin','degreed_professional_manager','program_manager','auditor','hr')
        or m.site_id = p_site_id
        or (m.role_key = 'dsp' and exists (
          select 1 from staff_assignments a where a.agency_id = p_agency_id
            and a.user_id = auth.uid() and a.site_id = p_site_id
            and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
        ))
      )
  );
$$;

create or replace function private.can_read_individual(p_agency_id uuid, p_individual_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.has_agency(p_agency_id)
    and private.has_permission(p_agency_id, 'individuals.view') and exists (
      select 1 from individuals i join memberships m on m.agency_id = i.agency_id
      where m.user_id = auth.uid() and i.agency_id = p_agency_id and i.id = p_individual_id
        and (
          (m.role_key <> 'dsp' and private.can_read_site(p_agency_id, i.site_id))
          or (m.role_key = 'dsp' and exists (
            select 1 from staff_assignments a where a.agency_id = p_agency_id
              and a.user_id = auth.uid() and a.individual_id = i.id
              and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
          ))
        )
    );
$$;

do $$
declare t record;
begin
  -- Enforce active agency membership on every tenant table, including tables
  -- whose legacy write policies only checked the role name.
  for t in select c.table_name from information_schema.columns c
    join pg_class pc on pc.oid = ('public.' || quote_ident(c.table_name))::regclass
    where c.table_schema = 'public' and c.column_name = 'agency_id' and pc.relkind = 'r'
  loop
    execute format('create policy audit_active_membership on public.%I as restrictive for all to authenticated using (private.has_agency(agency_id)) with check (private.has_agency(agency_id))', t.table_name);
  end loop;
  for t in select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'individual_id'
      and table_name not in ('staff_assignments','training_requirements')
  loop
    execute format('create policy audit_individual_scope on public.%I as restrictive for all to authenticated using (individual_id is null or private.can_read_individual(agency_id, individual_id)) with check (individual_id is null or private.can_read_individual(agency_id, individual_id))', t.table_name);
  end loop;
  for t in select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'site_id'
      and table_name not in ('memberships','training_requirements')
  loop
    execute format('create policy audit_site_scope on public.%I as restrictive for all to authenticated using (site_id is null or private.can_read_site(agency_id, site_id)) with check (site_id is null or private.can_read_site(agency_id, site_id))', t.table_name);
  end loop;
end $$;

-- IDs nested below another record must inherit that record's visibility.
create policy audit_version_scope on public.document_versions as restrictive for all to authenticated
using (exists (select 1 from documents d where d.id = document_id and private.can_read_individual(d.agency_id, d.individual_id)))
with check (exists (select 1 from documents d where d.id = document_id and private.can_read_individual(d.agency_id, d.individual_id)));
create policy audit_document_permission on public.documents as restrictive for select to authenticated
using (private.has_permission(agency_id, 'documents.view'));

-- A person's site, a source plan and its owner must belong to the same work.
create or replace function private.guard_requirement_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.individual_id is not null and not exists (
    select 1 from individuals i where i.id = new.individual_id and i.agency_id = new.agency_id and i.site_id = new.site_id
  ) then raise exception 'The individual does not belong to this site.'; end if;
  if new.owner_user_id is not null and not exists (
    select 1 from memberships m where m.user_id = new.owner_user_id and m.agency_id = new.agency_id
      and (m.expires_on is null or m.expires_on >= current_date)
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
create trigger requirements_guard_write before insert or update on public.requirement_definitions
for each row execute function private.guard_requirement_write();

-- Unstructured audit details may contain care information. Site-scoped staff
-- receive their own events; agency audit readers receive the agency history.
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events for select to authenticated using (
  private.has_agency(agency_id) and (
    actor_id = auth.uid() or (private.has_permission(agency_id, 'audit.read') and
      private.role_key_in(agency_id, array['administrator','compliance_admin','degreed_professional_manager','program_manager','auditor']))
  )
);
