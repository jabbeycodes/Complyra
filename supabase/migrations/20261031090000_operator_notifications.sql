-- UNAPPLIED: supported in-app/database reminder operations only.
begin;
create table operator_notice_templates(
 type text primary key check(type in ('documentation.missing_note','med.unrecorded','med.prn_repeat')),
 channel text not null default 'in_app' check(channel='in_app'),provider text not null default 'database' check(provider='database'),
 title_template text not null default '{{title}}',body_template text not null default '{{body}}',version integer not null default 1,
 updated_at timestamptz,updated_by uuid references profiles(id)
);
insert into operator_notice_templates(type) values('documentation.missing_note'),('med.unrecorded'),('med.prn_repeat');
create table operator_notice_template_history(
 id uuid primary key default gen_random_uuid(),type text not null references operator_notice_templates(type),version integer not null,
 title_template text not null,body_template text not null,actor_id uuid not null references profiles(id),reason text not null,created_at timestamptz not null default now(),unique(type,version)
);
create table operator_notice_failures(
 id uuid primary key default gen_random_uuid(),type text not null references operator_notice_templates(type),agency_id uuid not null references agencies(id),
 code text not null default 'enqueue_failed' check(code='enqueue_failed'),created_at timestamptz not null default now()
);
create index operator_notice_failures_time on operator_notice_failures(type,created_at desc);
alter table operator_notice_templates enable row level security;
alter table operator_notice_templates force row level security;
alter table operator_notice_template_history enable row level security;
alter table operator_notice_template_history force row level security;
alter table operator_notice_failures enable row level security;
alter table operator_notice_failures force row level security;
create policy operator_template_read on operator_notice_templates for select to authenticated using(private.is_platform_admin());
create policy operator_template_history_read on operator_notice_template_history for select to authenticated using(private.is_platform_admin());
create policy operator_failure_read on operator_notice_failures for select to authenticated using(private.is_platform_admin());
revoke all on operator_notice_templates,operator_notice_template_history,operator_notice_failures from anon,authenticated;
grant select on operator_notice_templates,operator_notice_template_history,operator_notice_failures to authenticated;
create trigger operator_template_history_immutable before update or delete on operator_notice_template_history for each row execute function private.forbid_audit_mutation();
create function operator_save_notice_template(p_type text,p_title text,p_body text,p_reason text,p_expected_version integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t operator_notice_templates%rowtype; event_id uuid; platform_id uuid;
begin
 perform private.require_operator();
 if p_title is null or p_body is null or length(p_title)>200 or length(p_body)>2000 or coalesce(array_length(string_to_array(p_title,'{{title}}'),1),0)<>2 or coalesce(array_length(string_to_array(p_body,'{{body}}'),1),0)<>2
 or strpos(replace(p_title,'{{title}}',''),'{{')>0 or strpos(replace(p_title,'{{title}}',''),'}}')>0 or strpos(replace(p_body,'{{body}}',''),'{{')>0 or strpos(replace(p_body,'{{body}}',''),'}}')>0
 or p_reason is null or length(trim(p_reason)) not between 1 and 500 or p_expected_version is null then raise exception 'Preserve original title/body tokens and add a reason.'; end if;
 select * into t from operator_notice_templates where type=p_type for update;
 if not found then raise exception 'Unsupported reminder type.'; end if;
 if t.version<>p_expected_version then raise exception 'Template changed. Refresh and try again.'; end if;
 update operator_notice_templates set title_template=p_title,body_template=p_body,version=version+1,updated_at=now(),updated_by=auth.uid() where type=p_type;
 insert into operator_notice_template_history(type,version,title_template,body_template,actor_id,reason) values(p_type,t.version+1,p_title,p_body,auth.uid(),trim(p_reason)) returning id into event_id;
 select id into platform_id from agencies where agency_code='COMPLYRER-MO';
 insert into audit_events(agency_id,actor_id,action,target_type,target_id,detail) values(platform_id,auth.uid(),'notification.template_changed','notification_template',event_id,p_type||' · '||trim(p_reason));
end $$;
revoke all on function operator_save_notice_template(text,text,text,text,integer) from public,anon;
grant execute on function operator_save_notice_template(text,text,text,text,integer) to authenticated;
create function private.apply_operator_notice_template() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare t operator_notice_templates%rowtype;
begin
 select * into t from operator_notice_templates where type=new.type;
 if found then new.title:=replace(t.title_template,'{{title}}',new.title);new.body:=replace(t.body_template,'{{body}}',new.body);end if;
 return new;
end $$;
create trigger operator_notice_template before insert on notifications for each row execute function private.apply_operator_notice_template();
create function operator_notice_failure(p_type text,p_agency_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.role()<>'service_role' then raise exception 'Service role required.' using errcode='42501'; end if;
 insert into operator_notice_failures(type,agency_id) values(p_type,p_agency_id);
end $$;
revoke all on function operator_notice_failure(text,uuid) from public,anon,authenticated;
grant execute on function operator_notice_failure(text,uuid) to service_role;
create function operator_communications(p_start date,p_end date,p_agency_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform private.require_operator();
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>365 then raise exception 'Choose a valid date range of at most 366 days.'; end if;
 return (with notices as(select * from notifications where created_at>=p_start::timestamp at time zone 'UTC' and created_at<(p_end+1)::timestamp at time zone 'UTC' and(p_agency_id is null or agency_id=p_agency_id))
 select jsonb_build_object('types',(select jsonb_agg(jsonb_build_object('type',t.type,'channel',t.channel,'provider',t.provider,'titleTemplate',t.title_template,'bodyTemplate',t.body_template,'version',t.version,'updatedAt',t.updated_at,
 'persisted',(select count(*) from notices where type=t.type),
 'read',(select count(*) from notices n where n.type=t.type and(n.read_at is not null or exists(select 1 from notification_reads where notification_id=n.id))),
 'lastPersisted',(select max(created_at) from notices where type=t.type),
 'enqueueFailures',(select count(*) from operator_notice_failures where type=t.type and created_at>=p_start::timestamp at time zone 'UTC' and created_at<(p_end+1)::timestamp at time zone 'UTC' and(p_agency_id is null or agency_id=p_agency_id))) order by t.type) from operator_notice_templates t),
 'producerJob',(select j from jsonb_array_elements(operator_health()->'jobs') j where j->>'jobKey'='sweep-operating-reminders')));
end $$;
revoke all on function operator_communications(date,date,uuid) from public,anon;
grant execute on function operator_communications(date,date,uuid) to authenticated;
commit;
