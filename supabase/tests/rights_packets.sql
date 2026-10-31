-- rights_packets.sql — pgTAP coverage for the annual Rights packet
-- store (migration 20261030170000_rights_packets.sql, written but NOT
-- applied until Joshua approves): read scoping, the manager-only
-- insert, the one-way completion transition, packet immutability,
-- evidence integrity, and agency-administrator read access (PR #171,
-- forward migration 20261031120000). Runs in CI (no local harness).
-- Assertions are effect-based where RLS turns a forbidden write
-- into a no-op.
begin;
create extension if not exists pgtap;

select plan(26);

-- Fixtures: two agencies; Agency A has two homes. Roles exercised:
-- home HM (own + other home), program manager, nurse, auditor, DSP,
-- agency administrator (Agency A), plus an Agency B packet + evidence
-- seeded directly as the cross-agency control.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','hm-a@example.com'),
  ('22222222-2222-2222-2222-222222222222','hm-b@example.com'),
  ('33333333-3333-3333-3333-333333333333','pm@example.com'),
  ('44444444-4444-4444-4444-444444444444','auditor@example.com'),
  ('55555555-5555-5555-5555-555555555555','dsp@example.com'),
  ('66666666-6666-6666-6666-666666666666','nurse@example.com'),
  ('77777777-7777-7777-7777-777777777777','hm-x@example.com'),
  ('88888888-8888-8888-8888-888888888888','admin-a@example.com')
on conflict (id) do nothing;

-- Agency codes are unique platform-wide and supabase/seed.sql already
-- owns 'EVERGREEN-MO', so this fixture uses its own codes.
insert into public.agencies (id, name, agency_code, state_code, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Agency A','RIGHTSA-MO','MO','active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Agency B','RIGHTSB-MO','MO','active')
on conflict (id) do nothing;

insert into public.programs (id, agency_id, name) values
  ('f1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Program A'),
  ('f2222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Program B')
on conflict (id) do nothing;

insert into public.sites (id, agency_id, program_id, name) values
  ('a1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f1111111-1111-1111-1111-111111111111','Home A'),
  ('a2222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','f1111111-1111-1111-1111-111111111111','Home B'),
  ('b1111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','f2222222-2222-2222-2222-222222222222','Home X')
on conflict (id) do nothing;

insert into public.memberships (agency_id, user_id, role, role_key, site_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','manager','house_manager','a1111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','manager','house_manager','a2222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','manager','program_manager',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','44444444-4444-4444-4444-444444444444','auditor','auditor',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','55555555-5555-5555-5555-555555555555','dsp','dsp','a1111111-1111-1111-1111-111111111111'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66666666-6666-6666-6666-666666666666','nurse','nurse',null),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','88888888-8888-8888-8888-888888888888','administrator','administrator',null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','77777777-7777-7777-7777-777777777777','manager','house_manager','b1111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into public.individuals (id, agency_id, site_id, full_name, date_of_birth) values
  ('c1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a1111111-1111-1111-1111-111111111111','Person A','1980-01-01'),
  ('c2222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','b1111111-1111-1111-1111-111111111111','Person X','1980-01-01')
on conflict (id) do nothing;

-- One awaiting packet, created by the home HM (seeded directly).
insert into public.rights_packets (id, agency_id, individual_id, created_by, signer_name) values
  ('d1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Dana Hart');

-- Cross-agency control: an Agency B packet + its evidence (seeded
-- directly, evidence in the migration's jsonb shape), readable by
-- Agency B's own HM — so the administrator's zero counts in the
-- admin section below are meaningful, not vacuous.
insert into public.rights_packets (id, agency_id, individual_id, created_by, signer_name) values
  ('d3333333-3333-3333-3333-333333333333','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','c2222222-2222-2222-2222-222222222222','77777777-7777-7777-7777-777777777777','Pat Hart');
insert into public.rights_packet_evidence (packet_id, agency_id, individual_id, evidence) values
  ('d3333333-3333-3333-3333-333333333333','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','c2222222-2222-2222-2222-222222222222','{"name":"filed-copy.pdf","mime":"application/pdf","contentBase64":"JVBERi0="}'::jsonb);

-- ── Read scoping (1–5) ──────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.rights_packets), 1, 'home HM reads the packet');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 1, 'auditor reads the packet (read-only)');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 0, 'DSP reads no packets');

select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 0, 'other-home HM reads none');

select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets where agency_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0, 'cross-agency manager reads none');

-- ── Writes: DSP and auditor cannot start packets (6–7) ─────────────
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.rights_packets (agency_id, individual_id, created_by, signer_name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','55555555-5555-5555-5555-555555555555','X')$$,
  '42501', null, 'DSP cannot start a packet');

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.rights_packets (agency_id, individual_id, created_by, signer_name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444','X')$$,
  '42501', null, 'auditor cannot start a packet');

-- ── The home HM starts a second (next-year) packet (8) ─────────────
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok(
  $$insert into public.rights_packets (id, agency_id, individual_id, created_by, signer_name)
    values ('d2222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Dana Hart')$$,
  'home HM starts a packet');

-- A future typed date is rejected on completion (9). The rejection
-- comes from the completion policy's WITH CHECK (packet_on <=
-- current_date in migration 20261030170000) — an RLS violation,
-- SQLSTATE 42501; there is no check constraint on packet_on.
select throws_ok(
  $$update public.rights_packets
    set status = 'signed', packet_on = '2999-01-01', reviewed_by = 'James Wilson',
        signer = '{"printedName":"Dana Hart","authority":"Guardian","authorityOther":"","signature":"Dana Hart","witness":"Casey Adams","accepted":true}'::jsonb,
        signed_at = now()
    where id = 'd2222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'future packet date rejected');

-- ── Completion with a TYPED past date (10–11) ──────────────────────
select lives_ok(
  $$update public.rights_packets
    set status = 'signed', packet_on = '2025-11-29', reviewed_by = 'James Wilson',
        signer = '{"printedName":"Dana Hart","authority":"Guardian","authorityOther":"","signature":"Dana Hart","witness":"Casey Adams","accepted":true}'::jsonb,
        signed_at = now()
    where id = 'd1111111-1111-1111-1111-111111111111'$$,
  'home HM completes the packet with a typed date');
select is((select packet_on from public.rights_packets where id = 'd1111111-1111-1111-1111-111111111111'), '2025-11-29'::date, 'typed date stored exactly as entered');

-- A pre-completed insert is refused by the insert policy (12).
select throws_ok(
  $$insert into public.rights_packets (agency_id, individual_id, created_by, signer_name, status, packet_on, signer)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','X','signed','2025-01-01','{}'::jsonb)$$,
  '42501', null, 'cannot insert a pre-completed packet');

-- ── Immutability: completed rows ignore later writes (13–16) ───────
select lives_ok(
  $$update public.rights_packets set packet_on = '2025-01-01' where id = 'd1111111-1111-1111-1111-111111111111'$$,
  'update attempt on a completed packet runs');
select is((select packet_on from public.rights_packets where id = 'd1111111-1111-1111-1111-111111111111'), '2025-11-29'::date, 'completed packet date is unchanged');
select lives_ok(
  $$delete from public.rights_packets where id = 'd1111111-1111-1111-1111-111111111111'$$,
  'delete attempt on a packet runs');
select is((select count(*)::int from public.rights_packets), 2, 'both packets survive; prior years stay in history');

-- ── Evidence: filed packets only, and rows are frozen (17–19) ─────
-- Evidence is the filed-on-paper scan, stored as one jsonb payload
-- (name/mime/contentBase64). The app files it in the same completion
-- that sets status='filed' (hostedApi completeRightsPacket), and the
-- insert policy requires a filed packet — so the packet above, which
-- completed by the in-app 'signed' path, cannot take evidence. The
-- manager-filed case is exercised in the administrator section below.
select throws_ok(
  $$insert into public.rights_packet_evidence (packet_id, agency_id, individual_id, evidence)
    values ('d1111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','{"name":"scan.pdf","mime":"application/pdf","contentBase64":"JVBERi0="}'::jsonb)$$,
  '42501', null, 'evidence cannot be filed on a signed (not filed) packet');
-- Immutability, exercised on Agency B's seeded evidence by its own
-- house manager: no update policy names anyone, so the attempt is a
-- no-op and the row keeps its payload.
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
select lives_ok(
  $$update public.rights_packet_evidence set evidence = '{"name":"other.pdf","mime":"application/pdf","contentBase64":"JVBERi0="}'::jsonb where packet_id = 'd3333333-3333-3333-3333-333333333333'$$,
  'evidence update attempt runs');
select is((select evidence->>'name' from public.rights_packet_evidence where packet_id = 'd3333333-3333-3333-3333-333333333333'), 'filed-copy.pdf', 'evidence row is unchanged');
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

-- ── Administrator read access (20–26) ──────────────────────────────
-- PR #171 put 'administrator' on the consent reader list, and the
-- rights-packet read policies carry that same list (made
-- forward-deterministic by migration 20261031120000 — the policies
-- exercised here are exactly the ones it recreates). This section
-- lives at the end because it first needs a FILED packet with
-- evidence in Agency A, which only exists once the second packet
-- is completed here. Claims still hold the home HM at that point.
select lives_ok(
  $$update public.rights_packets
    set status = 'filed', packet_on = '2025-11-29', reviewed_by = 'James Wilson',
        signer = '{"printedName":"Dana Hart","authority":"Guardian","authorityOther":"","signature":"Dana Hart","witness":"Casey Adams","accepted":true}'::jsonb,
        signed_at = now(), filed_at = now()
    where id = 'd2222222-2222-2222-2222-222222222222'$$,
  'home HM files the second packet');
select lives_ok(
  $$insert into public.rights_packet_evidence (packet_id, agency_id, individual_id, evidence)
    values ('d2222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1111111-1111-1111-1111-111111111111','{"name":"scan.pdf","mime":"application/pdf","contentBase64":"JVBERi0="}'::jsonb)$$,
  'manager files evidence on the filed packet');

select set_config('request.jwt.claims', '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 2, 'agency administrator reads the packets in their own agency');
select is((select count(*)::int from public.rights_packet_evidence), 1, 'agency administrator reads the packet evidence in their own agency');
select is((select count(*)::int from public.rights_packets where agency_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0, 'agency administrator reads no packets in another agency');
select is((select count(*)::int from public.rights_packet_evidence where agency_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0, 'agency administrator reads no packet evidence in another agency');

-- Positive control: the Agency B packet really is there and its own
-- house manager reads it, so the administrator zeros above are RLS
-- scoping, not missing rows.
select set_config('request.jwt.claims', '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
select is((select count(*)::int from public.rights_packets), 1, 'agency B HM reads their own packet');

select * from finish();
rollback;
