-- Free-text corrective actions may contain care details. Staff outside
-- agency management can access only actions they own or were assigned.
create policy corrective_actions_visible on public.corrective_actions as restrictive
for all to authenticated
using (private.has_agency(agency_id) and (
  private.role_key_in(agency_id,array['administrator','compliance_admin','degreed_professional_manager','program_manager','auditor'])
  or created_by_user_id=auth.uid() or assigned_to_user_id=auth.uid()
))
with check (private.has_agency(agency_id) and (
  private.role_key_in(agency_id,array['administrator','compliance_admin','degreed_professional_manager','program_manager','auditor'])
  or created_by_user_id=auth.uid() or assigned_to_user_id=auth.uid()
));

create or replace function private.corrective_action_identity_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.title is null or trim(new.title)='' then raise exception 'Give the corrective action a title.'; end if;
  if new.assigned_to_user_id is not null and not exists (
    select 1 from memberships m where m.agency_id=new.agency_id and m.user_id=new.assigned_to_user_id and (m.expires_on is null or m.expires_on>=current_date)
  ) then raise exception 'Assign an active member of this agency.'; end if;
  if TG_OP='INSERT' and auth.role()='authenticated' then
    new.created_by_user_id:=auth.uid();
  elsif TG_OP='UPDATE' and (new.agency_id<>old.agency_id or new.created_by_user_id<>old.created_by_user_id or new.id<>old.id) then
    raise exception 'Corrective action identity cannot be changed.';
  end if;
  return new;
end $$;
create trigger corrective_action_identity_guard before insert or update on public.corrective_actions
for each row execute function private.corrective_action_identity_guard();
