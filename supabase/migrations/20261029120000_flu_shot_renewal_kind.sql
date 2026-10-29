-- Flu shot joins the annual clinical renewals tracked per Individual
-- (alongside annual physical, vision, and dental). Widens the kind CHECK
-- on public.clinical_renewals so hosted flu_shot rows are accepted; the
-- app backfills the new default renewal for existing Individuals on chart
-- load (defaultRenewals in planStack.ts).
begin;

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'clinical_renewals'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%annual_physical%';
  if cname is not null then
    execute format(
      'alter table public.clinical_renewals drop constraint %I', cname);
  end if;
end $$;

alter table public.clinical_renewals
  add constraint clinical_renewals_kind_check
  check (kind in ('annual_physical', 'vision', 'dental', 'flu_shot',
                  'physician_orders'));

commit;
