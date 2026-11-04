-- PRN notice dedupe (simulation batch 199): one live notice per PRN dose per
-- recipient.
--
-- med.prn_repeat notices were keyed by a reminder slot, so while a follow-up
-- stayed open every recipient got a new row each interval (15 minutes by
-- default) from every sweep. The key now names the dose event, so
-- queue_operating_notice / queue_system_notice's existing ON CONFLICT DO
-- NOTHING holds it to one row. This migration adds the two pieces SQL owns:
--
-- 1. rearm_prn_repeat_notices keeps prn.reminder_repeat_minutes meaningful on
--    that one row: read, still open a full interval later, unread again.
--    A signed-in member re-arms only their own row; the unattended sweep
--    (service role) re-arms every recipient's.
-- 2. Slot-keyed rows still unread are retired by marking them read, the same
--    mechanism as retire_stale_missing_note_notices. Nothing is deleted. A
--    follow-up that is still open gets its one event-keyed notice on the next
--    sweep.

begin;

create or replace function public.rearm_prn_repeat_notices(
  p_agency_id uuid,
  p_dedupe_keys text[],
  p_repeat_minutes integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_rearmed integer;
begin
  if not v_is_service and (auth.uid() is null or not private.has_agency(p_agency_id)) then
    raise exception 'Not allowed';
  end if;

  update public.notifications n
  set read_at = null,
      created_at = now()
  where n.agency_id = p_agency_id
    and n.type = 'med.prn_repeat'
    and n.dedupe_key = any(coalesce(p_dedupe_keys, array[]::text[]))
    and n.read_at is not null
    -- The rule's own minimum is 5 minutes.
    and n.read_at <= now() - make_interval(mins => greatest(coalesce(p_repeat_minutes, 15), 5))
    and (v_is_service or n.user_id = auth.uid());

  get diagnostics v_rearmed = row_count;
  return v_rearmed;
end;
$$;

revoke all on function public.rearm_prn_repeat_notices(uuid, text[], integer) from public, anon;
grant execute on function public.rearm_prn_repeat_notices(uuid, text[], integer) to authenticated, service_role;

update public.notifications
set read_at = now()
where type = 'med.prn_repeat'
  and read_at is null
  and dedupe_key ~ '^med\.prn_repeat:[^:]+:[^:]+:[0-9]+$';

commit;
