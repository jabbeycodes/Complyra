-- Rights packets: the annual rights signoff packet, paperless.
--
-- UNAPPLIED — written for review; production application needs Joshua's
-- explicit go-ahead like every migration. Until it is applied, hosted
-- mode fails contained inside the Consents surfaces (the section shows
-- its own error; the Command Center load treats packets as optional).
--
-- On paper this packet is the rights signoff filed IN FRONT of an
-- Individual's consent forms in the binder, renewed every year. The
-- platform record mirrors that: one packet per signing, prior years
-- kept as history, and the annual renewal countdown anchors on
-- packet_on — the date a manager TYPES when the packet is completed.
-- The date is authoritative as entered: no trigger or default ever
-- re-stamps it, and completing (signing/filing) writes it exactly once.
--
-- Security model mirrors the consent packets family:
-- - Reads scope through private.can_read_individual AND the consent
--   reader role list (house_manager, program_manager, nurse, auditor).
--   DSPs never read packets, exactly like consent packets.
-- - Writes (insert, and the one completion update) require
--   private.can_manage_consent — the same gate the app enforces.
-- - A completed packet (signed_at set) is immutable, enforced by
--   trigger; the evidence table is immutable outright. There is NO
--   delete path — no policy, no grant.
-- - Signing happens in-app by signed-in staff (the packet is completed
--   with the signer present, or a signed paper copy is filed), so this
--   feature adds NO unauthenticated surface: anonymous callers get
--   nothing, and no token machinery exists here.
-- - NO new permission key: access rides on the consent role gates, so
--   the program_manager template trap does not apply.

begin;

create table public.rights_packets (
 id uuid primary key default gen_random_uuid(),
 agency_id uuid not null references public.agencies(id),
 individual_id uuid not null references public.individuals(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 signer_name text not null,
 reviewed_by text not null default '',
 packet_on date,
 status text not null default 'awaiting_signature' check (status in ('awaiting_signature','signed','filed')),
 signer jsonb,
 signed_at timestamptz,
 filed_at timestamptz,
 evidence_name text,
 copy_version text not null
);

create table public.rights_packet_evidence (
 packet_id uuid primary key references public.rights_packets(id),
 agency_id uuid not null,
 individual_id uuid not null,
 evidence jsonb not null
);

alter table public.rights_packets enable row level security;
alter table public.rights_packets force row level security;
alter table public.rights_packet_evidence enable row level security;
alter table public.rights_packet_evidence force row level security;

create policy rights_packets_read on public.rights_packets for select to authenticated using (
 private.can_read_individual(agency_id, individual_id) and private.role_key_in(agency_id, '{house_manager,program_manager,nurse,auditor}'));
create policy rights_packets_insert on public.rights_packets for insert to authenticated with check (
 private.can_manage_consent(agency_id, individual_id) and created_by = auth.uid() and status = 'awaiting_signature' and packet_on is null and signer is null and signed_at is null);
create policy rights_packets_complete on public.rights_packets for update to authenticated using (
 private.can_manage_consent(agency_id, individual_id) and status = 'awaiting_signature' and signed_at is null)
 with check (
 private.can_manage_consent(agency_id, individual_id) and status in ('signed','filed') and packet_on is not null and packet_on <= current_date and signer is not null);

create policy rights_packet_evidence_read on public.rights_packet_evidence for select to authenticated using (
 private.can_read_individual(agency_id, individual_id) and private.role_key_in(agency_id, '{house_manager,program_manager,nurse,auditor}'));
create policy rights_packet_evidence_insert on public.rights_packet_evidence for insert to authenticated with check (
 private.can_manage_consent(agency_id, individual_id)
 and exists (select 1 from public.rights_packets p where p.id = packet_id and p.status = 'filed' and p.agency_id = rights_packet_evidence.agency_id and p.individual_id = rights_packet_evidence.individual_id));

revoke all on public.rights_packets, public.rights_packet_evidence from public, anon, authenticated;
grant select, insert, update on public.rights_packets to authenticated;
grant select, insert on public.rights_packet_evidence to authenticated;

create function private.rights_packet_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op = 'DELETE' then
  raise exception 'Rights packet history cannot be deleted.' using errcode = '42501';
 end if;
 if tg_table_name = 'rights_packet_evidence' then
  raise exception 'Rights packet evidence is immutable.' using errcode = '42501';
 end if;
 -- rights_packets UPDATE: identity is frozen and completion is one-way.
 if old.signed_at is not null then
  raise exception 'Completed rights packets are immutable.' using errcode = '42501';
 end if;
 if new.id <> old.id or new.agency_id <> old.agency_id or new.individual_id <> old.individual_id
    or new.created_by <> old.created_by or new.created_at <> old.created_at
    or new.signer_name <> old.signer_name or new.copy_version <> old.copy_version then
  raise exception 'Rights packet identity is immutable.' using errcode = '42501';
 end if;
 if new.status not in ('signed','filed') or new.packet_on is null or new.signer is null or new.signed_at is null then
  raise exception 'A rights packet update must complete the packet.' using errcode = '42501';
 end if;
 if new.status = 'filed' and new.filed_at is null then
  raise exception 'A filed rights packet needs its filing time.' using errcode = '42501';
 end if;
 return new;
end;
$$;
create trigger rights_packets_guard before update or delete on public.rights_packets
 for each row execute function private.rights_packet_guard();
create trigger rights_packet_evidence_guard before update or delete on public.rights_packet_evidence
 for each row execute function private.rights_packet_guard();

revoke all on function private.rights_packet_guard() from public, anon, authenticated;

commit;
