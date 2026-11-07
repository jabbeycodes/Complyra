-- Wave 4E: link renewal evidence files to their clinical renewal.
--
-- Until now the only link between a clinical renewal and its files was
-- clinical_renewals.file_id pointing at the LATEST file. An evidence
-- upload re-pointed the renewal and the previous file became
-- unreachable from every surface (retest batch 312: a stranded test
-- file sat on a chart with no way to view or remove it).
--
-- chart_files gains the renewal it was uploaded for, plus the evidence
-- kind chosen at upload, so a renewal card can list every attached
-- file and remove each one on its own. Existing pointed files are
-- backfilled from clinical_renewals.file_id; older unlinked files keep
-- renewal_id null and stay reachable through the pointer.

alter table public.chart_files
  add column renewal_id uuid,
  add column evidence_kind text
    check (evidence_kind in ('consultation', 'doctor_notes', 'physician_orders', 'pdf'));

alter table public.chart_files
  add constraint chart_files_renewal_agency_fk
  foreign key (renewal_id, agency_id)
  references public.clinical_renewals (id, agency_id);

create index chart_files_renewal_id_idx on public.chart_files (renewal_id);

update public.chart_files f
set renewal_id = r.id,
    evidence_kind = r.last_evidence_kind
from public.clinical_renewals r
where r.file_id = f.id
  and r.agency_id = f.agency_id
  and f.renewal_id is null;
