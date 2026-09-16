-- Complyrer HR / Employee Hub — kiosk token resolution.
--
-- verify_kiosk_pin deliberately returns NO site fields (kiosk trust model:
-- the device authenticates through the RPC, never through table reads, and
-- token hashes never leave the DB). This companion function resolves a raw
-- kiosk token to its site + agency for kiosk setup time / HR admin and for
-- day-to-day kiosk branding before any staff member clocks in.
--
-- Security properties, matching the verify_kiosk_pin conventions:
--   - The raw token is hashed INSIDE the function (SHA-256 hex, the same
--     digest format as hr_kiosk_tokens.token_hash). Only the digest is used
--     in the WHERE clause; the digest never appears in the response, and the
--     function never returns the raw token, the hash, or any staff data.
--   - Only ACTIVE, non-revoked tokens resolve. Unknown, inactive, or revoked
--     tokens return {ok:false} and reveal nothing about the token set.
--   - SECURITY DEFINER with set search_path = public; granted to anon +
--     authenticated so an unauthenticated kiosk device can brand itself by
--     site name, exactly like verify_kiosk_pin.
-- ----------------------------------------------------------------------------

create or replace function public.resolve_kiosk_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.hr_kiosk_tokens%rowtype;
  v_site_name text;
begin
  select * into v_token
  from public.hr_kiosk_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and active
    and revoked_at is null
  limit 1;

  if v_token.id is null then
    return jsonb_build_object('ok', false);
  end if;

  select name into v_site_name
  from public.sites
  where id = v_token.site_id
    and agency_id = v_token.agency_id
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'site_id', v_token.site_id,
    'site_name', v_site_name,
    'agency_id', v_token.agency_id
  );
end;
$$;

comment on function public.resolve_kiosk_token(text) is
  'Resolves a raw kiosk token to its site + agency for kiosk setup/admin and kiosk device branding. The token is SHA-256-hashed inside the function; only the digest is compared, and neither the token, its hash, nor any staff data is ever returned.';

grant execute on function public.resolve_kiosk_token(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECURITY DEFINER RPC: submit_kiosk_punch(p_token, p_staff_id, p_kind,
--   p_punched_at, p_service_type, p_individual_id, p_attestation, p_note,
--   p_shift_id, p_offline) RETURNS uuid
--
-- The punch-writing path for kiosk devices. The kiosk is unauthenticated
-- (anon has no RLS policies on any table), so a direct INSERT is impossible
-- by design; this function is the ONLY way a kiosk writes hr_punches.
--
-- Security properties, matching the verify_kiosk_pin conventions:
--   - The raw token is hashed INSIDE the function (SHA-256 hex, the same
--     digest format as hr_kiosk_tokens.token_hash). Only active, non-revoked
--     tokens are accepted; anything else raises an exception (no {ok:false}
--     envelope here — the caller treats a bad token as a hard failure).
--   - verification_method is STAMPED server-side as 'kiosk_pin'. Any client
--     method is ignored — there is no method parameter at all.
--   - remote derives false from verification_method='kiosk_pin' through the
--     private.stamp_punch_remote trigger (see the hr_kiosk_timeclock
--     migration); kiosk punches are never remote punches.
--   - RLS is BYPASSED by design (security definer). Provenance is stamped
--     server-side: agency/site come from the token row, created_by is the
--     staffer, source is 'kiosk' — none of it is trusted from the caller.
-- ----------------------------------------------------------------------------

create or replace function public.submit_kiosk_punch(
  p_token text,
  p_staff_id uuid,
  p_kind text,
  p_punched_at timestamptz,
  p_service_type text,
  p_individual_id uuid,
  p_attestation jsonb,
  p_note text,
  p_shift_id uuid,
  p_offline boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.hr_kiosk_tokens%rowtype;
  v_punch_id uuid;
begin
  select * into v_token
  from public.hr_kiosk_tokens
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and active
    and revoked_at is null
  limit 1;

  if v_token.id is null then
    raise exception 'invalid kiosk token';
  end if;

  insert into public.hr_punches
    (agency_id, site_id, staff_id, kind, punched_at, source, note,
     shift_id, created_by, service_type, individual_id,
     verification_method, offline, attestation)
  values
    (v_token.agency_id, v_token.site_id, p_staff_id, p_kind, p_punched_at,
     'kiosk', nullif(btrim(coalesce(p_note, '')), ''),
     p_shift_id, p_staff_id,
     nullif(btrim(coalesce(p_service_type, '')), ''),
     p_individual_id, 'kiosk_pin',
     coalesce(p_offline, false), p_attestation)
  returning id into v_punch_id;

  update public.hr_kiosk_tokens
  set last_used_at = now()
  where id = v_token.id;

  return v_punch_id;
end;
$$;

comment on function public.submit_kiosk_punch(text, uuid, text, timestamptz, text, uuid, jsonb, text, uuid, boolean) is
  'Kiosk punch submission. The raw token is SHA-256-hashed inside the function and must belong to an active, non-revoked token (anything else raises). RLS is bypassed by design: this SECURITY DEFINER function is the only punch-writing path for kiosk devices, and provenance is stamped server-side — verification_method is always kiosk_pin (no client method is accepted) and remote derives false via the stamp_punch_remote trigger.';

revoke all on function public.submit_kiosk_punch(text, uuid, text, timestamptz, text, uuid, jsonb, text, uuid, boolean) from public;
grant execute on function public.submit_kiosk_punch(text, uuid, text, timestamptz, text, uuid, jsonb, text, uuid, boolean) to anon, authenticated;
