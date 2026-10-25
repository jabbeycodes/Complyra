-- Run the reminder when nobody has the app open.
-- This file does not contain a project URL or a key. The job is created only
-- when both Vault secrets already exist, and each run reads them then.
-- A local database without those secrets does nothing.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  if (
    select count(*)
    from vault.secrets
    where name in ('project_url', 'sweep_service_role_key')
  ) < 2 then
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'sweep-operating-reminders') then
    return;
  end if;

  perform cron.schedule(
    'sweep-operating-reminders',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/sweep-operating-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sweep_service_role_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 8000
    );
    $job$
  );
end $$;
