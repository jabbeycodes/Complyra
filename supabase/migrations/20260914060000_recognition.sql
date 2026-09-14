-- ============================================================================
-- 20260914060000_recognition.sql
-- Winners-only recognition (Complyrer Recognition build 1)
--
--   1. Bidirectional 1-5 ratings/reviews with exactly one current record per
--      reviewer/subject pair and direction, plus append-only history written
--      by AFTER triggers (never silently overwritten, never client-writable).
--        - DSP  -> House Manager : public.dsp_hm_ratings (+ _history)
--        - HM   -> DSP           : public.hm_dsp_reviews (+ _history)
--   2. Weekly winners + per-candidate score snapshots:
--        - public.recognition_winners        (celebration surface: winner +
--          highlights only — NO scores, so no ranking can leak; all members
--          read)
--        - public.recognition_score_snapshots (managers/admins only)
--   3. public.recognition_week_start(date) -> Monday helper.
--   4. private.share_active_site(agency, user_a, user_b) -> whether two
--      members share an active site (memberships or staff_assignments,
--      cross-matched). Ratings/reviews are only writable between members
--      assigned together.
--   4b. private.recognition_manager_view(agency, user_a, user_b) -> whether
--      the caller (a recognition.manage holder) may read a review between
--      user_a and user_b: administrators agency-wide, other managers only
--      where they share an active site with a party.
--   5. Reseeds public.role_permission_matrix with the recognition permission
--      keys (recognition.rate_hm, recognition.review_dsp,
--      recognition.view_winners, recognition.manage).
--
-- Notification types used by this feature (queued by the edge functions /
-- notify-event; the notifications table accepts any non-empty type):
--   rating.changed, review.changed,
--   recognition.hm_winner, recognition.dsp_winner.
--
-- DEPLOYMENT: this migration has NOT been applied to hosted Supabase.
-- Do not apply without Joshua's explicit "ship it live".
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Week helper: Monday of the week containing the given date
-- ----------------------------------------------------------------------------
create or replace function public.recognition_week_start(d date)
returns date
language sql immutable
as $$
  select d - ((extract(isodow from d)::int - 1) * interval '1 day')::interval;
$$;

-- ----------------------------------------------------------------------------
-- 0b. Assigned-together helper: two members share an active site.
-- A DSP may rate only their assigned HM; an HM may review only assigned DSPs.
-- "Assigned together" = the same site on both memberships, or overlapping
-- active staff_assignments at the same site.
-- ----------------------------------------------------------------------------
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
        and (m.expires_on is null or m.expires_on >= current_date)
      union
      select sa.site_id
      from public.staff_assignments sa
      where sa.agency_id = p_agency_id
        and sa.user_id = p_user_a
        and sa.site_id is not null
        and sa.starts_on <= current_date
        and (sa.ends_on is null or sa.ends_on >= current_date)
    )
    select 1
    from a_sites s
    where exists (
      select 1
      from public.memberships m
      where m.agency_id = p_agency_id
        and m.user_id = p_user_b
        and m.site_id = s.site_id
        and (m.expires_on is null or m.expires_on >= current_date)
    )
    or exists (
      select 1
      from public.staff_assignments sa
      where sa.agency_id = p_agency_id
        and sa.user_id = p_user_b
        and sa.site_id = s.site_id
        and sa.starts_on <= current_date
        and (sa.ends_on is null or sa.ends_on >= current_date)
    )
  );
$$;

-- Manager visibility for reviews: administrators (administrator /
-- compliance_admin) see the whole agency; any other recognition.manage
-- holder (DPM, program manager, customized templates) sees only reviews
-- where they share an active site with at least one party of the pair.
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
      and (m.expires_on is null or m.expires_on >= current_date)
  )
  or (select private.share_active_site(p_agency_id, auth.uid(), p_user_a))
  or (select private.share_active_site(p_agency_id, auth.uid(), p_user_b));
$$;

-- ----------------------------------------------------------------------------
-- 0c. Shared row trigger: touch updated_at on any update.
-- ----------------------------------------------------------------------------
create or replace function public.recognition_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1a. DSP -> HM ratings (exactly one current rating per DSP/HM pair)
-- ----------------------------------------------------------------------------
create table if not exists public.dsp_hm_ratings (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  dsp_id uuid not null references public.profiles(id) on delete cascade,
  hm_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dsp_hm_ratings_distinct check (dsp_id <> hm_id),
  constraint dsp_hm_ratings_pair unique (agency_id, dsp_id, hm_id)
);

create index if not exists dsp_hm_ratings_hm_idx
  on public.dsp_hm_ratings (agency_id, hm_id);
create index if not exists dsp_hm_ratings_dsp_idx
  on public.dsp_hm_ratings (agency_id, dsp_id);

-- Append-only history: every rating value change is recorded, never overwritten.
create table if not exists public.dsp_hm_rating_history (
  id uuid primary key default gen_random_uuid(),
  rating_id uuid not null references public.dsp_hm_ratings(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  old_rating smallint, -- null on the first rating
  new_rating smallint not null check (new_rating between 1 and 5),
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists dsp_hm_rating_history_rating_idx
  on public.dsp_hm_rating_history (rating_id, created_at desc);

-- AFTER triggers (the parent row must exist before the history row, whose
-- foreign key is immediate). The UPDATE trigger only fires on a real value
-- change, so same-value rewrites create neither history nor notifications.
create or replace function public.record_dsp_hm_rating_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.dsp_hm_rating_history
      (rating_id, agency_id, old_rating, new_rating, changed_by)
    values (NEW.id, NEW.agency_id, null, NEW.rating, NEW.dsp_id);
    return NEW;
  end if;
  insert into public.dsp_hm_rating_history
    (rating_id, agency_id, old_rating, new_rating, changed_by)
  values (NEW.id, NEW.agency_id, OLD.rating, NEW.rating, NEW.dsp_id);
  return NEW;
end;
$$;

-- Pair identity is immutable: a rating row can never be repointed at a
-- different reviewer, subject, or agency.
create or replace function public.freeze_dsp_hm_rating_pair()
returns trigger
language plpgsql
as $$
begin
  if NEW.agency_id is distinct from OLD.agency_id
     or NEW.dsp_id is distinct from OLD.dsp_id
     or NEW.hm_id is distinct from OLD.hm_id then
    raise exception 'recognition pair identity is immutable';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_dsp_hm_rating_history_ins on public.dsp_hm_ratings;
create trigger trg_dsp_hm_rating_history_ins
  after insert on public.dsp_hm_ratings
  for each row execute function public.record_dsp_hm_rating_change();

drop trigger if exists trg_dsp_hm_rating_history_upd on public.dsp_hm_ratings;
create trigger trg_dsp_hm_rating_history_upd
  after update of rating on public.dsp_hm_ratings
  for each row
  when (OLD.rating is distinct from NEW.rating)
  execute function public.record_dsp_hm_rating_change();

drop trigger if exists trg_dsp_hm_ratings_touch on public.dsp_hm_ratings;
create trigger trg_dsp_hm_ratings_touch
  before update on public.dsp_hm_ratings
  for each row execute function public.recognition_touch_updated_at();

drop trigger if exists trg_dsp_hm_rating_freeze on public.dsp_hm_ratings;
create trigger trg_dsp_hm_rating_freeze
  before update on public.dsp_hm_ratings
  for each row execute function public.freeze_dsp_hm_rating_pair();

-- ----------------------------------------------------------------------------
-- 1b. HM -> DSP reviews (exactly one current review per HM/DSP pair)
-- ----------------------------------------------------------------------------
create table if not exists public.hm_dsp_reviews (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  hm_id uuid not null references public.profiles(id) on delete cascade,
  dsp_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hm_dsp_reviews_distinct check (hm_id <> dsp_id),
  constraint hm_dsp_reviews_pair unique (agency_id, hm_id, dsp_id)
);

create index if not exists hm_dsp_reviews_dsp_idx
  on public.hm_dsp_reviews (agency_id, dsp_id);
create index if not exists hm_dsp_reviews_hm_idx
  on public.hm_dsp_reviews (agency_id, hm_id);

create table if not exists public.hm_dsp_review_history (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.hm_dsp_reviews(id) on delete cascade,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  old_rating smallint, -- null on the first review
  new_rating smallint not null check (new_rating between 1 and 5),
  changed_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists hm_dsp_review_history_review_idx
  on public.hm_dsp_review_history (review_id, created_at desc);

create or replace function public.record_hm_dsp_review_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.hm_dsp_review_history
      (review_id, agency_id, old_rating, new_rating, changed_by)
    values (NEW.id, NEW.agency_id, null, NEW.rating, NEW.hm_id);
    return NEW;
  end if;
  insert into public.hm_dsp_review_history
    (review_id, agency_id, old_rating, new_rating, changed_by)
  values (NEW.id, NEW.agency_id, OLD.rating, NEW.rating, NEW.hm_id);
  return NEW;
end;
$$;

create or replace function public.freeze_hm_dsp_review_pair()
returns trigger
language plpgsql
as $$
begin
  if NEW.agency_id is distinct from OLD.agency_id
     or NEW.hm_id is distinct from OLD.hm_id
     or NEW.dsp_id is distinct from OLD.dsp_id then
    raise exception 'recognition pair identity is immutable';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_hm_dsp_review_history_ins on public.hm_dsp_reviews;
create trigger trg_hm_dsp_review_history_ins
  after insert on public.hm_dsp_reviews
  for each row execute function public.record_hm_dsp_review_change();

drop trigger if exists trg_hm_dsp_review_history_upd on public.hm_dsp_reviews;
create trigger trg_hm_dsp_review_history_upd
  after update of rating on public.hm_dsp_reviews
  for each row
  when (OLD.rating is distinct from NEW.rating)
  execute function public.record_hm_dsp_review_change();

drop trigger if exists trg_hm_dsp_reviews_touch on public.hm_dsp_reviews;
create trigger trg_hm_dsp_reviews_touch
  before update on public.hm_dsp_reviews
  for each row execute function public.recognition_touch_updated_at();

drop trigger if exists trg_hm_dsp_review_freeze on public.hm_dsp_reviews;
create trigger trg_hm_dsp_review_freeze
  before update on public.hm_dsp_reviews
  for each row execute function public.freeze_hm_dsp_review_pair();

-- ----------------------------------------------------------------------------
-- 2a. Weekly winners (celebration surface — readable by every agency member)
--
-- Winners store the winner + positive highlights ONLY. Raw scores and
-- breakdowns live in recognition_score_snapshots (managers/admins only), so
-- no ranking can ever be reconstructed from the public table.
-- ----------------------------------------------------------------------------
create table if not exists public.recognition_winners (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  week_start date not null, -- Monday
  category text not null
    check (category in ('hm_of_the_week', 'dsp_of_the_week')),
  winner_id uuid not null references public.profiles(id) on delete cascade,
  highlights text[] not null default '{}',
  decided_at timestamptz not null default now(),
  constraint recognition_winners_unique
    unique (agency_id, week_start, category)
);

create index if not exists recognition_winners_agency_week_idx
  on public.recognition_winners (agency_id, week_start desc);

-- ----------------------------------------------------------------------------
-- 2b. Score snapshots (every candidate's breakdown; managers/admins only —
--     never surfaced publicly, so no ranking leaks)
-- ----------------------------------------------------------------------------
create table if not exists public.recognition_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  week_start date not null, -- Monday
  category text not null
    check (category in ('hm_of_the_week', 'dsp_of_the_week')),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(6, 2) not null,
  score_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint recognition_score_snapshots_unique
    unique (agency_id, week_start, category, candidate_id)
);

-- ----------------------------------------------------------------------------
-- 3. RLS — private-by-default; winners are the only public surface
-- ----------------------------------------------------------------------------
alter table public.dsp_hm_ratings enable row level security;
alter table public.dsp_hm_rating_history enable row level security;
alter table public.hm_dsp_reviews enable row level security;
alter table public.hm_dsp_review_history enable row level security;
alter table public.recognition_winners enable row level security;
alter table public.recognition_score_snapshots enable row level security;

-- Ratings are private to the pair, appropriate managers, and admins.
-- "Appropriate managers" = recognition.manage holders: administrators and
-- compliance admins see the whole agency; DPMs, program managers, and
-- customized templates see only pairs they share an active site with
-- (private.recognition_manager_view). The explicit DPM/PM leg keeps manager
-- visibility under per-agency customized matrices.
drop policy if exists dsp_hm_ratings_select on public.dsp_hm_ratings;
create policy dsp_hm_ratings_select on public.dsp_hm_ratings
  for select using (
    (select private.has_agency(agency_id))
    and (
      dsp_id = auth.uid()
      or hm_id = auth.uid()
      or (
        (select private.has_permission(agency_id, 'recognition.manage'))
        and (select private.recognition_manager_view(agency_id, dsp_id, hm_id))
      )
    )
  );

-- Only an active DSP writes their own rating, and only about an HM they are
-- assigned together with (shared active site). No deletes: history is
-- permanent. The freeze trigger additionally rejects any UPDATE that tries
-- to repoint reviewer/subject/agency.
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
        and (m.expires_on is null or m.expires_on >= current_date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), hm_id))
  );
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
        and (m.expires_on is null or m.expires_on >= current_date)
    )
  ) with check (
    dsp_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.rate_hm'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = dsp_hm_ratings.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'dsp'
        and (m.expires_on is null or m.expires_on >= current_date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), hm_id))
  );

drop policy if exists dsp_hm_rating_history_select on public.dsp_hm_rating_history;
create policy dsp_hm_rating_history_select on public.dsp_hm_rating_history
  for select using (
    (select private.has_agency(agency_id))
    and exists (
      select 1 from public.dsp_hm_ratings r
      where r.id = dsp_hm_rating_history.rating_id
        and (
          r.dsp_id = auth.uid()
          or r.hm_id = auth.uid()
          or (
            (select private.has_permission(r.agency_id, 'recognition.manage'))
            and (select private.recognition_manager_view(r.agency_id, r.dsp_id, r.hm_id))
          )
        )
    )
  );
-- History is append-only: writes happen only inside the security-definer
-- triggers, so there is intentionally NO authenticated insert/update/delete
-- policy on the history table.

-- Only an active HM writes their own review, and only about a DSP they are
-- assigned together with (shared active site). No deletes.
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
        and (m.expires_on is null or m.expires_on >= current_date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), dsp_id))
  );
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
        and (m.expires_on is null or m.expires_on >= current_date)
    )
  ) with check (
    hm_id = auth.uid()
    and (select private.has_permission(agency_id, 'recognition.review_dsp'))
    and exists (
      select 1 from public.memberships m
      where m.agency_id = hm_dsp_reviews.agency_id
        and m.user_id = auth.uid()
        and m.role_key = 'house_manager'
        and (m.expires_on is null or m.expires_on >= current_date)
    )
    and (select private.share_active_site(agency_id, auth.uid(), dsp_id))
  );

drop policy if exists hm_dsp_reviews_select on public.hm_dsp_reviews;
create policy hm_dsp_reviews_select on public.hm_dsp_reviews
  for select using (
    (select private.has_agency(agency_id))
    and (
      hm_id = auth.uid()
      or dsp_id = auth.uid()
      or (
        (select private.has_permission(agency_id, 'recognition.manage'))
        and (select private.recognition_manager_view(agency_id, hm_id, dsp_id))
      )
    )
  );

drop policy if exists hm_dsp_review_history_select on public.hm_dsp_review_history;
create policy hm_dsp_review_history_select on public.hm_dsp_review_history
  for select using (
    (select private.has_agency(agency_id))
    and exists (
      select 1 from public.hm_dsp_reviews r
      where r.id = hm_dsp_review_history.review_id
        and (
          r.hm_id = auth.uid()
          or r.dsp_id = auth.uid()
          or (
            (select private.has_permission(r.agency_id, 'recognition.manage'))
            and (select private.recognition_manager_view(r.agency_id, r.hm_id, r.dsp_id))
          )
        )
    )
  );

-- Winners: the celebration surface. Every agency member may read them.
-- (The table carries highlights only — no scores — so nothing here can
-- reconstruct a ranking.)
drop policy if exists recognition_winners_select on public.recognition_winners;
create policy recognition_winners_select on public.recognition_winners
  for select using ((select private.has_agency(agency_id)));
-- Writes are service_role only (the select-weekly-winners edge function).

-- Snapshots: managers/admins only, so scores never leak into a ranking.
drop policy if exists recognition_score_snapshots_select
  on public.recognition_score_snapshots;
create policy recognition_score_snapshots_select
  on public.recognition_score_snapshots
  for select using (
    (select private.has_permission(agency_id, 'recognition.manage'))
  );
-- Writes are service_role only.

-- ----------------------------------------------------------------------------
-- 4. role_permission_matrix reseed — recognition keys
--    (generated from src/data/permissions.ts; JSON key order follows
--    PERMISSION_KEYS). Idempotent upsert on conflict.
-- ----------------------------------------------------------------------------
insert into public.role_permission_matrix (role_key, permissions)
values
    ('administrator', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('compliance_admin', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":true,"roles.manage":true,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('house_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":true,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('degreed_professional_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":true,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":true,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('program_manager', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":true,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":true}'::jsonb),
    ('dsp', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":false,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":true,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('nurse', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":true,"requirements.approve":true,"requirements.complete":true,"acknowledgments.manage":false,"acknowledgments.sign_own":true,"clinical.view":true,"audit.read":true,"audit.export":false,"sites.create":false,"certificates.manage":false,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('hr', '{"members.invite":true,"members.assign_roles":true,"members.reset_password":false,"roles.manage":false,"hr.view_staff":true,"individuals.view":false,"documents.view":false,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":false,"audit.read":false,"audit.export":false,"sites.create":false,"certificates.manage":true,"mileage.manage":true,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb),
    ('auditor', '{"members.invite":false,"members.assign_roles":false,"members.reset_password":false,"roles.manage":false,"hr.view_staff":false,"individuals.view":true,"documents.view":true,"documents.upload":false,"requirements.approve":false,"requirements.complete":false,"acknowledgments.manage":false,"acknowledgments.sign_own":false,"clinical.view":true,"audit.read":true,"audit.export":true,"sites.create":false,"certificates.manage":false,"mileage.manage":false,"recognition.rate_hm":false,"recognition.review_dsp":false,"recognition.view_winners":true,"recognition.manage":false}'::jsonb)
on conflict (role_key) do update
set permissions = excluded.permissions,
    updated_at = now();


commit;

-- ----------------------------------------------------------------------------
-- 5. Weekly selection wiring (register at deploy time — NOT in this migration)
--
-- Recommended production wiring (pick ONE), Sundays 06:05 UTC, right after
-- the HM-checklist scheduler:
--
--   A) External cron (RECOMMENDED — Vercel Cron / GitHub Actions / any
--      scheduler), Sundays 06:05 UTC:
--        POST https://<project-ref>.supabase.co/functions/v1/select-weekly-winners
--        Authorization: Bearer <service_role_key>
--
--   B) pg_cron — only where the extension is actually available (it also
--      needs the pg_net extension for the HTTP call):
/*
select cron.schedule(
  'select-weekly-winners-sunday',
  '5 6 * * 0',  -- Sundays 06:05 UTC, after schedule-hm-checklists-sunday
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/select-weekly-winners',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <service_role_key>'
    ),
    body := '{}'::jsonb
  );
  $$
);
-- To remove: select cron.unschedule('select-weekly-winners-sunday');
*/

-- ----------------------------------------------------------------------------
-- 5. Atomic review submission RPCs
--
-- submit_dsp_hm_rating() / submit_hm_dsp_review() perform the whole
-- submission in ONE database transaction: upsert the current value, let the
-- AFTER trigger append the history row, and queue the reviewed person's
-- notification — all atomically. A review change can never succeed while its
-- notification fails. Same-value submissions are a no-op (changed = false,
-- no history row, no notification).
--
-- Returns jsonb: { "changed": bool, "rating": int, "history_id": uuid|null }.
-- ----------------------------------------------------------------------------
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
      and (m.expires_on is null or m.expires_on >= current_date)
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
      and (m.expires_on is null or m.expires_on >= current_date)
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
      and (m.expires_on is null or m.expires_on >= current_date)
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
      and (m.expires_on is null or m.expires_on >= current_date)
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

grant execute on function public.submit_dsp_hm_rating(uuid, smallint) to authenticated;
grant execute on function public.submit_hm_dsp_review(uuid, smallint) to authenticated;
