-- Wave 5 (retest batch 323): persist the title typed at upload on EACH
-- chart file, not only on the renewal row.
--
-- The renewal evidence form collects a document title per upload. Both
-- backends resolved it (typed title, else filename) but stored it only
-- in clinical_renewals.last_document_title — the LATEST file's title.
-- The chart_files row itself kept only the raw filename, so the per-file
-- list PR #262 added could show nothing but filenames: upload two files
-- titled "W4 B323 evidence 1" and "2" and both rows read as their
-- filenames, the typed titles nowhere on the card.
--
-- chart_files gains a per-file title. Rows saved before this migration
-- keep title null and the app falls back to the filename — except the
-- file a renewal currently points at, whose title IS the renewal's
-- last_document_title by construction; backfill those.

alter table public.chart_files
  add column title text;

update public.chart_files f
set title = r.last_document_title
from public.clinical_renewals r
where r.file_id = f.id
  and r.agency_id = f.agency_id
  and f.title is null
  and r.last_document_title is not null;
