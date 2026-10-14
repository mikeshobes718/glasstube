-- GlassTube WP6: server-confirmed delivery (2026-10). Corrected for the live
-- Berth backend, 2026-10-14.
--
-- Backend: production GLASSTUBE_SUPABASE_URL is Berth (api.atberth.com), app
-- `glasstube`. Verified from `berth logs --app glasstube`: live traffic is
-- glasstube_poll / _push / _touch / _new_pair, and the WP6 probes 404.
--
-- Berth runs ONE statement per request, so there is no begin/commit here.
-- Statements are separated by lines reading exactly `-- @@`, run in order with
-- scripts/sql/run-berth.sh. Every statement is idempotent (add column if not
-- exists / create or replace), so a partial run can simply be re-run.
--
-- Checked against the live definitions (pg_get_functiondef) and
-- information_schema on 2026-10-14. Differences from the first draft:
--   1. glasstube_pairs ALREADY HAS ack_seq (integer not null default 0). The
--      live glasstube_ack writes it on every consume. Reusing it for delivery
--      reports made a 'got' for push N land on a row still saying 'playing'
--      for push N-1, so /api/push answered "Playing" for every later push.
--      Delivery reports now use their own rep_* columns; the JSON keys that
--      api/_delivery.js reads (ack_seq, ack_state, ...) are unchanged.
--      The draft's rollback dropped ack_seq, a live column. It no longer does.
--   2. Rows are found with the live glasstube_find(p_key): trims the key,
--      matches link_token or upper(code), and ignores expired rows. The draft
--      matched without trim or expiry. Updates then target the primary key.
--   3. No revoke/grant block. The live functions are owned by app_glasstube
--      with default (public) EXECUTE; the draft revoked public and granted to
--      Supabase roles (anon/authenticated/service_role) that do not exist on
--      Berth. New functions get the same defaults as the live ones.
--   4. No `notify pgrst` (Berth is not PostgREST).
--   Confirmed as assumed: code (6 chars, upper), link_token (64 hex, all 72
--   rows), dest_seq integer, glasstube_poll(p_code text) -> jsonb,
--   glasstube_ack(p_code text, p_seq integer) -> jsonb.
--
-- Rollback, one statement each:
--   drop function if exists public.glasstube_hud_poll(text, text, text);
--   drop function if exists public.glasstube_ack_state(text, integer, text, text);
--   drop function if exists public.glasstube_delivery(text);
--   drop function if exists public.glasstube_supersede(text, text);
--   alter table public.glasstube_pairs drop column if exists hud_seen_at, drop column if exists hud_build,
--     drop column if exists hud_who, drop column if exists rep_seq, drop column if exists rep_state,
--     drop column if exists rep_detail, drop column if exists rep_at, drop column if exists superseded_by;

-- @@
alter table public.glasstube_pairs
  add column if not exists hud_seen_at   timestamptz,
  add column if not exists hud_build     text,
  add column if not exists hud_who       text,
  add column if not exists rep_seq       integer,
  add column if not exists rep_state     text,
  add column if not exists rep_detail    text,
  add column if not exists rep_at        timestamptz,
  add column if not exists superseded_by text
-- @@
create or replace function public.glasstube_hud_poll(p_code text, p_build text, p_who text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := public.glasstube_poll(p_code);
  if coalesce(v->>'ok', 'false') = 'true' and v->>'code' is not null then
    update public.glasstube_pairs
       set hud_seen_at = now(),
           hud_build   = nullif(left(coalesce(p_build, ''), 40), ''),
           hud_who     = left(coalesce(nullif(p_who, ''), 'hud'), 16)
     where code = v->>'code';
  end if;
  return v;
end;
$$
-- @@
create or replace function public.glasstube_ack_state(p_code text, p_seq integer, p_state text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r glasstube_pairs%rowtype;
  v_state text := lower(coalesce(nullif(p_state, ''), 'got'));
begin
  if v_state not in ('got', 'hidden', 'missed', 'pinch', 'playing', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'Unknown delivery state.');
  end if;
  if p_seq is null then
    return jsonb_build_object('ok', false, 'error', 'seq required');
  end if;
  -- 'got' and 'missed' also consume, exactly as today's ack does.
  if v_state in ('got', 'missed') then
    perform public.glasstube_ack(p_code, p_seq);
  end if;
  r := public.glasstube_find(p_code);
  if r.code is null then
    return jsonb_build_object('ok', true);
  end if;
  update public.glasstube_pairs p
     set rep_seq    = p_seq,
         rep_state  = v_state,
         rep_detail = left(p_detail, 300),
         rep_at     = now()
   where p.code = r.code
     -- A 'got' that arrives after a later state for the same push must not undo it.
     and not (v_state = 'got'
              and p.rep_seq is not distinct from p_seq
              and p.rep_state is not null
              and p.rep_state <> 'got');
  return jsonb_build_object('ok', true);
end;
$$
-- @@
create or replace function public.glasstube_delivery(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r glasstube_pairs%rowtype;
begin
  r := public.glasstube_find(p_code);
  if r.code is null then
    return jsonb_build_object('ok', false, 'missing', true);
  end if;
  return jsonb_build_object(
    'ok',         true,
    'hud_seen_s', case when r.hud_seen_at is null then null
                       else greatest(0, floor(extract(epoch from now() - r.hud_seen_at)))::integer end,
    'hud_build',  r.hud_build,
    'hud_who',    r.hud_who,
    'ack_seq',    r.rep_seq,
    'ack_state',  r.rep_state,
    'ack_detail', r.rep_detail,
    'ack_age_s',  case when r.rep_at is null then null
                       else greatest(0, floor(extract(epoch from now() - r.rep_at)))::integer end,
    'dest_seq',   r.dest_seq,
    'superseded', r.superseded_by is not null);
end;
$$
-- @@
create or replace function public.glasstube_supersede(p_old text, p_new_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_old is null or p_old !~ '^[A-Fa-f0-9]{64}$' or coalesce(trim(p_new_code), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad arguments');
  end if;
  if not exists (select 1 from public.glasstube_pairs where code = upper(trim(p_new_code))) then
    return jsonb_build_object('ok', false, 'error', 'unknown new code');
  end if;
  update public.glasstube_pairs p
     set superseded_by = upper(trim(p_new_code))
   where p.link_token = lower(p_old)
     and p.superseded_by is null
     and p.code is distinct from upper(trim(p_new_code));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'superseded', n);
end;
$$
