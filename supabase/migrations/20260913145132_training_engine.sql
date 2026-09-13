-- Complyrer LifePath Phase 2: staff compliance profile + training engine.
-- Tables for training requirements (per-line), sign-offs (typed initials, not
-- checkmarks), and whole-checklist countersignatures, plus signature-mark
-- columns on the legacy training_checklists. Training topic seeds live in code
-- (src/features/training/topics.ts) so LocalApi and HostedApi serve identical
-- topics; only the stateful records live in Supabase.
--
-- Conventions follow the Phase 1 migration: RLS enabled + forced,
-- agency-scoped rows, (select private.has_agency(...)) style policies, and
-- append-only audit.

-- Training requirements: one row per training line per staff member.
create table public.training_requirements (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  user_id uuid not null,
  topic_id text not null,
  individual_id uuid,
  site_id uuid,
  source text not null check (source in ('checklist', 'plan_version', 'corrective', 'delegation')),
  plan_version_id uuid,
  delegation_id text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'complete', 'overdue', 'waived_na')),
  due_on date,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, user_id, topic_id, site_id, individual_id),
  foreign key (agency_id) references public.agencies (id) on delete cascade,
  foreign key (user_id) references public.profiles (id) on delete cascade
);

-- Training sign-offs: typed initials per line (no checkmarks), N/A with reason,
-- hours (total + with-HM for the in-ratio gate), trainer/method, competency
-- evidence, and renewal rules with next-due computation.
create table public.training_signoffs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  requirement_id uuid not null,
  initials text not null,
  signed_on date not null,
  na boolean not null default false,
  na_reason text,
  trainer_name text not null,
  method text check (method in ('shadowing', 'classroom', 'video', 'hands-on', 'reading')),
  hours_total numeric not null default 0,
  hours_with_hm numeric not null default 0,
  competency_text text,
  observer_name text,
  observer_signature text,
  evidence_ref text,
  renewal_rule text,
  next_due_on date,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (requirement_id),
  foreign key (requirement_id, agency_id)
    references public.training_requirements (id, agency_id) on delete cascade
);

-- Whole-checklist countersignatures: staff signs their own sheet, then the
-- house manager countersigns (typed name + signature mark, SignaturePad pattern).
create table public.training_countersignatures (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  user_id uuid not null,
  site_id uuid not null,
  staff_signature_name text,
  staff_signature_mark text,
  staff_signed_at timestamptz,
  hm_signature_name text,
  hm_signature_mark text,
  hm_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, user_id, site_id),
  foreign key (agency_id) references public.agencies (id) on delete cascade,
  foreign key (user_id) references public.profiles (id) on delete cascade
);

-- Legacy checklist signature marks (SignaturePad pattern on the Phase-1 model).
alter table public.training_checklists
  add column staff_signature_mark text,
  add column hm_signature_mark text;

create index training_requirements_user_idx
  on public.training_requirements (agency_id, user_id);
create index training_requirements_site_idx
  on public.training_requirements (agency_id, site_id);
create index training_requirements_individual_idx
  on public.training_requirements (agency_id, individual_id);
create index training_signoffs_requirement_idx
  on public.training_signoffs (agency_id, requirement_id);
create index training_countersignatures_user_idx
  on public.training_countersignatures (agency_id, user_id);

create trigger training_countersignatures_updated_at before update on public.training_countersignatures
  for each row execute function private.set_updated_at();

alter table public.training_requirements enable row level security;
alter table public.training_requirements force row level security;
alter table public.training_signoffs enable row level security;
alter table public.training_signoffs force row level security;
alter table public.training_countersignatures enable row level security;
alter table public.training_countersignatures force row level security;

-- Read: anyone in the agency can read training state.
create policy training_requirements_select on public.training_requirements
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy training_signoffs_select on public.training_signoffs
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy training_countersignatures_select on public.training_countersignatures
for select to authenticated
using ((select private.has_agency(agency_id)));

-- Requirement rows: managers/HR/nurse assign and waive.
create policy training_requirements_write on public.training_requirements
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,hr,program_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,hr,program_manager}')));

-- Sign-offs: staff initial their own lines; managers can record on behalf.
create policy training_signoffs_insert on public.training_signoffs
for insert to authenticated
with check (
  (select private.has_agency(agency_id))
  and (
    exists (
      select 1 from public.training_requirements r
      where r.id = requirement_id and r.user_id = (select auth.uid())
    )
    or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,hr,program_manager}'))
  )
);

create policy training_signoffs_update on public.training_signoffs
for update to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')));

-- Countersignatures: staff sign their own sheet; the house manager countersigns.
create policy training_countersignatures_write on public.training_countersignatures
for all to authenticated
using (
  user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
)
with check (
  user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
);
