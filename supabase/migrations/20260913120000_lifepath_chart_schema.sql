-- Complyrer LifePath Phase 1: hosted schema for individual charts, monthly
-- checks, site reviews, and agency branding. Mirrors the local workspace
-- collections in src/data/localApi.ts (obligations, signatures, renewals,
-- chart files, medications, deliveries, training checklists, monthly cycles,
-- site facts/reviews, branding) so the hosted API can replace its stubs.
--
-- Conventions follow the foundation migration: RLS enabled + forced,
-- agency-scoped rows, (select private.has_agency(...)) style policies, and
-- append-only audit. Permission gating matches the local role-key helpers
-- (canEditCover, canToggleDelegation, canManageEquipment, canCompleteMonthly,
-- canEditSiteReview, canManageAgencyLogo, canSeeRenewals, canRecordDelivery).

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
      and role_key = any(p_keys)
  );
$$;

revoke all on function private.role_key_in(uuid, text[]) from public;
grant execute on function private.role_key_in(uuid, text[]) to authenticated;

-- Individual chart: cover-page profile (IndividualProfile in planStack.ts).
create table public.individual_profiles (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (individual_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

-- Individual chart: plan-stack obligations (ObligationItem in planStack.ts).
create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  kind text not null check (kind in ('pcsp', 'protocol', 'delegation', 'shift_task', 'inventory')),
  mode text not null default 'required' check (mode in ('required', 'checked')),
  title text not null,
  detail text not null default '',
  source_page integer,
  document_version_id uuid,
  enabled boolean not null default true,
  frequency text not null default 'On plan update',
  shift_periods text[] not null default '{}',
  expires_on date,
  created_from text not null default 'manual' check (created_from in ('extraction', 'manual')),
  inventory_state text not null default 'present'
    check (inventory_state in ('unchecked', 'present', 'missing', 'na')),
  proposed boolean not null default false,
  delegating_rn_user_id uuid references public.profiles (id),
  rn_signed_at timestamptz,
  rn_signature_name text,
  rn_signature_mark text,
  discontinued_at timestamptz,
  discontinue_file_id uuid,
  discontinue_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  foreign key (document_version_id, agency_id)
    references public.document_versions (id, agency_id)
);

-- Individual chart: per-staff signature rows (ObligationSignature).
create table public.obligation_signatures (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  obligation_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  staff_name text not null,
  opened_at timestamptz,
  signed_at timestamptz,
  signature_name text,
  signature_mark text,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (obligation_id, user_id),
  foreign key (obligation_id, agency_id)
    references public.obligations (id, agency_id) on delete cascade
);

-- Individual chart: required-document packet submissions.
create table public.packet_submissions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  user_id uuid not null references public.profiles (id),
  submitted_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (individual_id, user_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

-- Individual chart: stored PDFs (renewal evidence, discontinuation orders).
create table public.chart_files (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  kind text not null check (kind in ('renewal', 'discontinue', 'training', 'other')),
  name text not null,
  mime text not null default 'application/pdf',
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

-- Individual chart: clinical renewals (ClinicalRenewal in planStack.ts).
create table public.clinical_renewals (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  kind text not null
    check (kind in ('annual_physical', 'vision', 'dental', 'physician_orders')),
  title text not null,
  interval_months integer not null default 12 check (interval_months > 0),
  last_uploaded_on date,
  next_due_on date not null,
  last_document_title text,
  last_evidence_kind text
    check (last_evidence_kind in ('consultation', 'doctor_notes', 'physician_orders', 'pdf')),
  file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (individual_id, kind),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  foreign key (file_id, agency_id)
    references public.chart_files (id, agency_id)
);

-- Individual chart: medications and the countdown concept
-- (Medication / MedicationDelivery in chart.ts).
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  name text not null,
  strength text not null default '',
  kind text not null default 'scheduled' check (kind in ('scheduled', 'prn')),
  controlled boolean not null default false,
  pills_per_day numeric not null default 0 check (pills_per_day >= 0),
  remaining_pills numeric not null default 0 check (remaining_pills >= 0),
  last_delivery_on date,
  last_countdown_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

create table public.medication_deliveries (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  medication_id uuid not null,
  counted_on date not null,
  remaining_pills numeric not null default 0,
  pills_per_day numeric not null default 0,
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete cascade
);

-- Individual chart: PRN dose log (required audit trail for logPrnDose).
create table public.prn_dose_logs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  medication_id uuid not null,
  logged_on date not null,
  logged_at timestamptz not null default now(),
  pills_used numeric not null,
  remaining_after numeric not null default 0,
  logged_by text not null default '',
  logged_by_user_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (medication_id, agency_id)
    references public.medications (id, agency_id) on delete cascade
);

-- Individual chart: staff in-home training checklists (TrainingChecklist).
-- Note: checklist lines stay a jsonb array (TrainingLine[]), mirroring the
-- local model exactly — each line carries its own id, title, and initialedAt,
-- so no separate lines table is needed.
create table public.training_checklists (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  staff_user_id uuid not null references public.profiles (id) on delete cascade,
  staff_name text not null,
  document_version_id uuid,
  items jsonb not null default '[]'::jsonb,
  staff_signed_at timestamptz,
  staff_signature_name text,
  hm_signed_at timestamptz,
  hm_signature_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade,
  foreign key (document_version_id, agency_id)
    references public.document_versions (id, agency_id)
);

-- Monthly checks: agency-configurable due days (MonthlyDueSettings).
create table public.agency_monthly_due (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  equipment_day integer not null default 7 check (equipment_day between 1 and 28),
  drill_day integer not null default 7 check (drill_day between 1 and 28),
  safety_day integer not null default 7 check (safety_day between 1 and 28)
);

-- Monthly checks: adaptive equipment (AdaptiveEquipment).
create table public.adaptive_equipment (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  individual_id uuid not null,
  name text not null,
  source text not null default 'manual' check (source in ('pcsp', 'manual')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  foreign key (individual_id, agency_id)
    references public.individuals (id, agency_id) on delete cascade
);

-- Monthly checks: one log row per equipment per month (EquipmentMonthLog).
create table public.equipment_month_logs (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  equipment_id uuid not null,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  checked_on date,
  initials text,
  checked_by_user_id uuid references public.profiles (id),
  comments text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (equipment_id, month_key),
  foreign key (equipment_id, agency_id)
    references public.adaptive_equipment (id, agency_id) on delete cascade
);

-- Monthly checks: emergency drills (EmergencyDrill).
create table public.emergency_drills (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  drill_type text not null check (drill_type in (
    'fire', 'tornado', 'earthquake', 'severe_weather',
    'intruder', 'missing_person', 'medical_emergency'
  )),
  date date,
  time text,
  evac_time text,
  leader_name text,
  participants text not null default '',
  awake_or_sleep text not null default '' check (awake_or_sleep in ('awake', 'sleep', '')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (site_id, month_key, drill_type),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

-- Monthly checks: home safety reports (HomeSafetyReport; lines are SafetyLine[]).
create table public.home_safety_reports (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (site_id, month_key),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

-- Site reviews: working-copy site facts (SiteFacts; sites table keeps only
-- the core identity columns).
create table public.site_facts (
  site_id uuid primary key,
  agency_id uuid not null,
  facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

-- Site reviews: working-copy environmental site review (SiteReview).
create table public.site_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  site_id uuid not null,
  reviewer_name text not null default '',
  support_coordinator text not null default '',
  reviewed_on date,
  provider_owned_controlled boolean,
  heightened_scrutiny boolean,
  meets_individual_needs boolean,
  part2_verified boolean not null default false,
  lines jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (site_id),
  foreign key (site_id, agency_id)
    references public.sites (id, agency_id) on delete cascade
);

-- Agency branding: logo storage reference (logo bytes live in storage).
create table public.agency_branding (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  logo_path text,
  updated_at timestamptz not null default now()
);

create index individual_profiles_agency_individual_idx
  on public.individual_profiles (agency_id, individual_id);
create index obligations_agency_individual_idx
  on public.obligations (agency_id, individual_id);
create index obligation_signatures_obligation_idx
  on public.obligation_signatures (obligation_id);
create index obligation_signatures_user_idx
  on public.obligation_signatures (user_id);
create index packet_submissions_individual_idx
  on public.packet_submissions (individual_id);
create index chart_files_individual_idx
  on public.chart_files (agency_id, individual_id);
create index clinical_renewals_individual_idx
  on public.clinical_renewals (agency_id, individual_id);
create index medications_individual_idx
  on public.medications (agency_id, individual_id);
create index medication_deliveries_medication_idx
  on public.medication_deliveries (medication_id);
create index prn_dose_logs_medication_idx
  on public.prn_dose_logs (medication_id);
create index training_checklists_individual_idx
  on public.training_checklists (agency_id, individual_id);
create index training_checklists_staff_idx
  on public.training_checklists (staff_user_id);
create index adaptive_equipment_individual_idx
  on public.adaptive_equipment (agency_id, individual_id);
create index equipment_month_logs_equipment_idx
  on public.equipment_month_logs (equipment_id, month_key);
create index emergency_drills_site_month_idx
  on public.emergency_drills (site_id, month_key);
create index home_safety_reports_site_month_idx
  on public.home_safety_reports (site_id, month_key);
create index site_reviews_agency_idx on public.site_reviews (agency_id);

create trigger individual_profiles_updated_at before update on public.individual_profiles
for each row execute function private.set_updated_at();
create trigger obligations_updated_at before update on public.obligations
for each row execute function private.set_updated_at();
create trigger clinical_renewals_updated_at before update on public.clinical_renewals
for each row execute function private.set_updated_at();
create trigger medications_updated_at before update on public.medications
for each row execute function private.set_updated_at();
create trigger training_checklists_updated_at before update on public.training_checklists
for each row execute function private.set_updated_at();
create trigger adaptive_equipment_updated_at before update on public.adaptive_equipment
for each row execute function private.set_updated_at();
create trigger equipment_month_logs_updated_at before update on public.equipment_month_logs
for each row execute function private.set_updated_at();
create trigger emergency_drills_updated_at before update on public.emergency_drills
for each row execute function private.set_updated_at();
create trigger home_safety_reports_updated_at before update on public.home_safety_reports
for each row execute function private.set_updated_at();
create trigger site_facts_updated_at before update on public.site_facts
for each row execute function private.set_updated_at();
create trigger site_reviews_updated_at before update on public.site_reviews
for each row execute function private.set_updated_at();
create trigger agency_branding_updated_at before update on public.agency_branding
for each row execute function private.set_updated_at();

alter table public.individual_profiles enable row level security;
alter table public.obligations enable row level security;
alter table public.obligation_signatures enable row level security;
alter table public.packet_submissions enable row level security;
alter table public.chart_files enable row level security;
alter table public.clinical_renewals enable row level security;
alter table public.medications enable row level security;
alter table public.medication_deliveries enable row level security;
alter table public.prn_dose_logs enable row level security;
alter table public.training_checklists enable row level security;
alter table public.agency_monthly_due enable row level security;
alter table public.adaptive_equipment enable row level security;
alter table public.equipment_month_logs enable row level security;
alter table public.emergency_drills enable row level security;
alter table public.home_safety_reports enable row level security;
alter table public.site_facts enable row level security;
alter table public.site_reviews enable row level security;
alter table public.agency_branding enable row level security;

alter table public.individual_profiles force row level security;
alter table public.obligations force row level security;
alter table public.obligation_signatures force row level security;
alter table public.packet_submissions force row level security;
alter table public.chart_files force row level security;
alter table public.clinical_renewals force row level security;
alter table public.medications force row level security;
alter table public.medication_deliveries force row level security;
alter table public.prn_dose_logs force row level security;
alter table public.training_checklists force row level security;
alter table public.agency_monthly_due force row level security;
alter table public.adaptive_equipment force row level security;
alter table public.equipment_month_logs force row level security;
alter table public.emergency_drills force row level security;
alter table public.home_safety_reports force row level security;
alter table public.site_facts force row level security;
alter table public.site_reviews force row level security;
alter table public.agency_branding force row level security;

-- Read: any agency member. Write gates mirror the local role-key helpers.
create policy individual_profiles_select on public.individual_profiles
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy individual_profiles_write on public.individual_profiles
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')));

create policy obligations_select on public.obligations
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy obligations_write on public.obligations
for all to authenticated
using (
  (select private.can_approve(agency_id))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,nurse}'))
)
with check (
  (select private.can_approve(agency_id))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,nurse}'))
);

create policy obligation_signatures_select on public.obligation_signatures
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy obligation_signatures_insert on public.obligation_signatures
for insert to authenticated
with check (
  (select private.can_approve(agency_id))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,nurse}'))
);

create policy obligation_signatures_update on public.obligation_signatures
for update to authenticated
using (
  user_id = (select auth.uid())
  or (select private.can_approve(agency_id))
)
with check (
  user_id = (select auth.uid())
  or (select private.can_approve(agency_id))
);

create policy obligation_signatures_delete on public.obligation_signatures
for delete to authenticated
using ((select private.can_approve(agency_id)));

create policy packet_submissions_select on public.packet_submissions
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy packet_submissions_insert on public.packet_submissions
for insert to authenticated
with check ((select private.has_agency(agency_id)));

create policy chart_files_select on public.chart_files
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy chart_files_write on public.chart_files
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse}')));

create policy clinical_renewals_select on public.clinical_renewals
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy clinical_renewals_write on public.clinical_renewals
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,program_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,program_manager}')));

create policy medications_select on public.medications
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy medications_write on public.medications
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')));

create policy medication_deliveries_select on public.medication_deliveries
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy medication_deliveries_write on public.medication_deliveries
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse}')));

create policy prn_dose_logs_select on public.prn_dose_logs
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy prn_dose_logs_write on public.prn_dose_logs
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')));

create policy training_checklists_select on public.training_checklists
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy training_checklists_insert on public.training_checklists
for insert to authenticated
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,program_manager}')));

create policy training_checklists_update on public.training_checklists
for update to authenticated
using (
  staff_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
)
with check (
  staff_user_id = (select auth.uid())
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}'))
);

create policy monthly_due_select on public.agency_monthly_due
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy monthly_due_write on public.agency_monthly_due
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')));

create policy adaptive_equipment_select on public.adaptive_equipment
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy adaptive_equipment_write on public.adaptive_equipment
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')));

create policy equipment_logs_select on public.equipment_month_logs
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy equipment_logs_write on public.equipment_month_logs
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')));

create policy drills_select on public.emergency_drills
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy drills_write on public.emergency_drills
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')));

create policy safety_reports_select on public.home_safety_reports
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy safety_reports_write on public.home_safety_reports
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager,nurse,dsp}')));

create policy site_facts_select on public.site_facts
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy site_facts_write on public.site_facts
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')));

create policy site_reviews_select on public.site_reviews
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy site_reviews_write on public.site_reviews
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,house_manager,degreed_professional_manager}')));

create policy branding_select on public.agency_branding
for select to authenticated
using ((select private.has_agency(agency_id)));

create policy branding_write on public.agency_branding
for all to authenticated
using ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')))
with check ((select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager}')));

-- createSite needs site/program writes; the foundation migration only
-- shipped select policies for these two tables.
drop policy if exists sites_write on public.sites;
create policy sites_write on public.sites
for all to authenticated
using (
  (select private.has_permission(agency_id, 'sites.create'))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,program_manager}'))
)
with check (
  (select private.has_permission(agency_id, 'sites.create'))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,program_manager}'))
);

drop policy if exists programs_write on public.programs;
create policy programs_write on public.programs
for all to authenticated
using (
  (select private.has_permission(agency_id, 'sites.create'))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,program_manager}'))
)
with check (
  (select private.has_permission(agency_id, 'sites.create'))
  or (select private.role_key_in(agency_id, '{administrator,compliance_admin,degreed_professional_manager,program_manager}'))
);

-- Agency logo bucket (PNG/JPEG; chart PDFs stay in agency-documents).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agency-assets',
  'agency-assets',
  false,
  1500000,
  array['image/png', 'image/jpeg']::text[]
)
on conflict (id) do nothing;

create policy storage_assets_select on storage.objects
for select to authenticated
using (
  bucket_id = 'agency-assets'
  and (select private.has_agency((storage.foldername(name))[2]::uuid))
);

create policy storage_assets_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'agency-assets'
  and (select private.role_key_in(
    (storage.foldername(name))[2]::uuid,
    '{administrator,compliance_admin,degreed_professional_manager}'
  ))
);

create policy storage_assets_update on storage.objects
for update to authenticated
using (
  bucket_id = 'agency-assets'
  and (select private.role_key_in(
    (storage.foldername(name))[2]::uuid,
    '{administrator,compliance_admin,degreed_professional_manager}'
  ))
)
with check (
  bucket_id = 'agency-assets'
  and (select private.role_key_in(
    (storage.foldername(name))[2]::uuid,
    '{administrator,compliance_admin,degreed_professional_manager}'
  ))
);

create policy storage_assets_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'agency-assets'
  and (select private.role_key_in(
    (storage.foldername(name))[2]::uuid,
    '{administrator,compliance_admin,degreed_professional_manager}'
  ))
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.individual_profiles,
  public.obligations,
  public.obligation_signatures,
  public.packet_submissions,
  public.chart_files,
  public.clinical_renewals,
  public.medications,
  public.medication_deliveries,
  public.prn_dose_logs,
  public.training_checklists,
  public.agency_monthly_due,
  public.adaptive_equipment,
  public.equipment_month_logs,
  public.emergency_drills,
  public.home_safety_reports,
  public.site_facts,
  public.site_reviews,
  public.agency_branding
to authenticated;
grant select, insert, update, delete on public.sites, public.programs to authenticated;
