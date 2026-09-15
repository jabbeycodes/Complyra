-- Fresh Supabase projects do not necessarily inherit dashboard-created
-- default grants. Backend provisioning must work after migrations alone.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

-- Policies do not grant SQL privileges. Enable exactly the operations for
-- which each new table defines an authenticated RLS policy.
do $$
declare p record; operation text;
begin
  for p in select tablename,cmd from pg_policies
    where schemaname='public' and 'authenticated'=any(roles) and permissive='PERMISSIVE'
  loop
    foreach operation in array case when p.cmd='ALL' then array['SELECT','INSERT','UPDATE','DELETE'] else array[p.cmd] end
    loop
      -- Existing column grants (e.g. notification read state) stay narrow.
      if not has_table_privilege('authenticated', 'public.' || quote_ident(p.tablename), operation)
        and (operation='DELETE' or not has_any_column_privilege('authenticated', 'public.' || quote_ident(p.tablename), operation)) then
        if p.tablename='notifications' and operation='UPDATE' then
          execute 'grant update(read_at) on public.notifications to authenticated';
        else
          execute format('grant %s on public.%I to authenticated',operation,p.tablename);
        end if;
      end if;
    end loop;
  end loop;
end $$;
