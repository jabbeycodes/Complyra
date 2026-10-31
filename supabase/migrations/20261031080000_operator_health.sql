-- UNAPPLIED: trusted job observations. No arbitrary browser writes/triggering.
begin;
create table operator_job_runs(
 id uuid primary key default gen_random_uuid(),job_key text not null check(job_key in ('sweep-operating-reminders','delegation-ack-sweep','schedule-hm-checklists','select-weekly-winners')),
 started_at timestamptz not null default now(),finished_at timestamptz,state text not null default 'running' check(state in ('running','succeeded','failed')),
 error_code text check(error_code is null or error_code ~ '^(http_[45][0-9]{2}|unhandled)$'),duration_ms bigint check(duration_ms>=0)
);
create index operator_job_time on operator_job_runs(job_key,started_at desc);
alter table operator_job_runs enable row level security;
alter table operator_job_runs force row level security;
create policy operator_job_read on operator_job_runs for select to authenticated using(private.is_platform_admin());
revoke all on operator_job_runs from anon,authenticated;
grant select on operator_job_runs to authenticated;
create function operator_job_start(p_job text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare id uuid;
begin
 if auth.role()<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 insert into operator_job_runs(job_key) values(p_job) returning operator_job_runs.id into id;return id;
end $$;
create function operator_job_finish(p_run_id uuid,p_state text,p_error_code text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 if p_state is null or p_state not in ('succeeded','failed') then raise exception 'Invalid job outcome.'; end if;
 update operator_job_runs set state=p_state,finished_at=clock_timestamp(),error_code=p_error_code,duration_ms=greatest(0,round(extract(epoch from(clock_timestamp()-started_at))*1000)::bigint) where id=p_run_id and state='running';
 if not found then raise exception 'Running observation not found.'; end if;
end $$;
revoke all on function operator_job_start(text),operator_job_finish(uuid,text,text) from public,anon,authenticated;
grant execute on function operator_job_start(text),operator_job_finish(uuid,text,text) to service_role;
create function operator_health() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 return (with catalog(job,seconds) as(values('sweep-operating-reminders',1800),('delegation-ack-sweep',172800),('schedule-hm-checklists',691200),('select-weekly-winners',691200))
 select jsonb_build_object('checkedAt',now(),'jobs',jsonb_agg(jsonb_build_object('jobKey',c.job,'expectedSeconds',c.seconds,
 'latest',(select jsonb_build_object('id',r.id,'jobKey',r.job_key,'startedAt',r.started_at,'finishedAt',r.finished_at,'state',r.state,'errorCode',r.error_code,'durationMs',r.duration_ms) from operator_job_runs r where r.job_key=c.job order by r.started_at desc,r.id desc limit 1),
 'lastSuccess',(select max(finished_at) from operator_job_runs where job_key=c.job and state='succeeded'),
 'failures24h',(select count(*) from operator_job_runs where job_key=c.job and state='failed' and started_at>=now()-interval '24 hours')) order by c.job)) from catalog c);
end $$;
revoke all on function operator_health() from public,anon;
grant execute on function operator_health() to authenticated;
commit;
