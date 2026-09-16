-- 2026-09-16: merge Degreed Professional Manager (DPM) into Program Manager (PM).
--
-- Locked decision (Joshua, 2026-09-16): DPM and PM are the same role. The single
-- surviving role is "Program Manager" (short code PM, key program_manager) with
-- the wider former-DPM permission pack.
--
-- This migration:
--   1. Updates private.role_key_in / private.can_grant_role_key so any RLS policy
--      that historically referenced only degreed_professional_manager keeps
--      authorizing the migrated program_manager memberships. Both functions keep
--      their exact signatures; the retired key is normalized inside the body.
--   2. Merges agency_roles rows customized under BOTH keys: permissions merge
--      with true-wins, then the degreed row is removed.
--   3. Renames remaining degreed_professional_manager agency_roles + memberships
--      to program_manager, then backfills agency program_manager rows with any
--      canonical permissions they lack (existing agency choices win, mirroring
--      the seed's "missing capabilities inherit defaults" pattern).
--   4. Refreshes the canonical role_templates + role_permission_matrix rows for
--      program_manager to the wider former-DPM permission pack.
--   5. Deletes the retired degreed_professional_manager template/matrix rows.
-- Historical migrations are left untouched.

begin;

-- ---------------------------------------------------------------------------
-- 1. Compatibility: old policies naming degreed_professional_manager still work
-- ---------------------------------------------------------------------------
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
      -- retired key: the merged Program Manager carries its access forward
      and role_key = any(
        array_replace(p_keys, 'degreed_professional_manager', 'program_manager')
      )
      and (expires_on is null or expires_on >= current_date)
  );
$$;

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
      -- the retired DPM key is evaluated as the merged Program Manager key
      case when p_target_key = 'degreed_professional_manager'
           then 'program_manager' else p_target_key end as t
  ) norm
  cross join lateral (
    select
      norm.t in (
        'administrator', 'compliance_admin', 'house_manager',
        'program_manager',
        'dsp', 'nurse', 'hr', 'auditor'
      ) as key_ok,
      case
        when norm.t = 'administrator' then exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.agency_id = p_agency_id
            and (m.expires_on is null or m.expires_on >= current_date)
            and m.role_key = 'administrator'
        )
        when norm.t = 'compliance_admin' then exists (
          select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.agency_id = p_agency_id
            and (m.expires_on is null or m.expires_on >= current_date)
            and m.role_key in ('administrator', 'compliance_admin')
        )
        else true
      end as hierarchy_ok
  ) h;
$$;

revoke all on function private.role_key_in(uuid, text[]) from public;
grant execute on function private.role_key_in(uuid, text[]) to authenticated;
revoke all on function private.can_grant_role_key(uuid, text) from public;
grant execute on function private.can_grant_role_key(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Merge agency_roles rows customized under both keys (true-wins on JSON)
-- ---------------------------------------------------------------------------
-- agency_roles is unique(agency_id, template_key): an agency may hold one row
-- per key. Where both exist, fold the DPM row's grants into the PM row.
update public.agency_roles pm
set permissions = (
      select jsonb_object_agg(
        key,
        (pm.permissions -> key) is not distinct from to_jsonb(true)
        or (dpm.permissions -> key) is not distinct from to_jsonb(true)
      )
      from (
        select distinct key
        from jsonb_each(coalesce(pm.permissions, '{}'::jsonb))
        union
        select distinct key
        from jsonb_each(coalesce(dpm.permissions, '{}'::jsonb))
      ) keys
    )
from public.agency_roles dpm
where dpm.agency_id = pm.agency_id
  and dpm.template_key = 'degreed_professional_manager'
  and pm.template_key = 'program_manager';

-- Now the merged DPM rows are redundant: drop them where a PM row exists.
delete from public.agency_roles
where template_key = 'degreed_professional_manager'
  and exists (
    select 1 from public.agency_roles pm2
    where pm2.agency_id = agency_roles.agency_id
      and pm2.template_key = 'program_manager'
  );

-- ---------------------------------------------------------------------------
-- 3. Rename the rest: agency_roles, then memberships
-- ---------------------------------------------------------------------------
-- Remaining DPM-only agency rows become Program Manager rows (unique on
-- (agency_id, template_key) is safe: step 2 removed every conflicting pair).
update public.agency_roles
set template_key = 'program_manager',
    name = 'Program Manager',
    short_code = 'PM'
where template_key = 'degreed_professional_manager';

-- memberships are unique(agency_id, user_id): one role per user per agency,
-- so the rename can never collide.
update public.memberships
set role_key = 'program_manager'
where role_key = 'degreed_professional_manager';

-- ---------------------------------------------------------------------------
-- 4. Refresh the canonical Program Manager rows to the wider DPM pack
-- ---------------------------------------------------------------------------
-- Canonical permission JSON generated from src/data/permissions.ts
-- (ROLE_TEMPLATE_BY_KEY["program_manager"].permissions), 2026-09-16.
insert into public.role_templates
  (key, name, short_code, description, default_scope, capability, permissions)
values (
  'program_manager',
  'Program Manager',
  'PM',
  'Program-level oversight across homes: creates and approves ISPs/PCSPs, uploads and signs plans, reviews delegation training, and resets staff passwords.',
  'program',
  'manager',
  '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb
)
on conflict (key) do update set
  name = excluded.name,
  short_code = excluded.short_code,
  description = excluded.description,
  default_scope = excluded.default_scope,
  capability = excluded.capability,
  permissions = excluded.permissions;

insert into public.role_permission_matrix (role_key, permissions)
values (
  'program_manager',
  '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"documents.review":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"qa.audit":false,"qa.dispute":true,"qa.schedule":true,"sites.create":true,"correctiveActions.manage":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true,"delegation.templates.view":true,"delegation.templates.manage":false,"delegation.activate":true,"delegation.assign":true,"delegation.training.review":true,"delegation.training.approve":true,"delegation.acknowledge":true}'::jsonb
)
on conflict (role_key) do update set
  permissions = excluded.permissions,
  updated_at = now();

-- Agency Program Manager rows inherit canonical permissions they lack;
-- explicit agency choices win (same pattern as the seed migration).
update public.agency_roles a
set permissions = m.permissions || a.permissions
from public.role_permission_matrix m
where m.role_key = 'program_manager'
  and a.template_key = 'program_manager';

-- ---------------------------------------------------------------------------
-- 5. Retire the DPM template + matrix rows
-- ---------------------------------------------------------------------------
-- Safe: steps 2-3 removed every agency_roles row referencing the old key, and
-- the FK from agency_roles.template_key would raise otherwise.
delete from public.role_permission_matrix where role_key = 'degreed_professional_manager';
delete from public.role_templates where key = 'degreed_professional_manager';

-- ---------------------------------------------------------------------------
-- Guardrails: fail loudly if the merge left anything behind
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.role_templates where key = 'degreed_professional_manager') then
    raise exception 'merge migration failed: degreed_professional_manager template row still present';
  end if;
  if exists (select 1 from public.role_permission_matrix where role_key = 'degreed_professional_manager') then
    raise exception 'merge migration failed: degreed_professional_manager matrix row still present';
  end if;
  if exists (select 1 from public.memberships where role_key = 'degreed_professional_manager') then
    raise exception 'merge migration failed: memberships still reference degreed_professional_manager';
  end if;
  if exists (select 1 from public.agency_roles where template_key = 'degreed_professional_manager') then
    raise exception 'merge migration failed: agency_roles still reference degreed_professional_manager';
  end if;
end;
$$;

commit;
