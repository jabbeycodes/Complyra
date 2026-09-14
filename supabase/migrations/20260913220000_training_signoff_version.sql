-- Per-line e-initials: version the training sign-off so an edited line
-- voids its previous initialing and must be re-initialed. Each version gets
-- its own tamper-evident signature event on field
-- `line:<requirement_id>:v<signoff_version>`; the old version's event stays
-- as history. Existing rows default to version 1.
alter table public.training_signoffs
  add column if not exists signoff_version integer not null default 1;
