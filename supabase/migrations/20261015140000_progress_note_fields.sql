-- Progress-note completeness. A new note stores the waiver service it
-- documents and a snapshot of the staff signature. Older notes stay blank.
-- Not applied to a remote project from this change.

alter table public.shift_notes
  add column if not exists waiver_service text not null default '',
  add column if not exists signature_data_url text not null default '';
