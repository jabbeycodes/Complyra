-- THERAP-CORE-GAPS-2: the core health trackers on the Individual chart —
-- intake (meals & fluids with daily totals), elimination (the bowel
-- tracking log, urination, emesis), vitals, seizures, menses, skin
-- monitoring, blood glucose, and respiratory treatments.
--
-- These kinds ride the batch-1 table public.health_track_entries
-- (migration 20261027120000_therap_core_gaps_1.sql): one entry shape with
-- kind-specific fields in the details jsonb, the same RLS policies, and the
-- same health.record permission. The only schema change is widening the
-- kind check so the new tracker kinds can be stored.
--
-- Clinically significant entries (out-of-range vitals or glucose, blood in
-- the stool, skin breakdown or worsening, every seizure, a refused meal,
-- a very-low-fluid day) alert the home's house manager directly plus
-- program-manager and nurse broadcasts through the follow-up notification
-- infrastructure, deduped per entry/day and target — enforced in the API
-- layer, mirroring batch 1.

alter table public.health_track_entries
  drop constraint health_track_entries_kind_check;

alter table public.health_track_entries
  add constraint health_track_entries_kind_check
  check (kind in (
    'immunization', 'lab', 'infection', 'sleep',
    'intake', 'elimination', 'vitals', 'seizure',
    'menses', 'skin', 'glucose', 'respiratory'
  ));
