-- GlassTube WP6: server-confirmed delivery (2026-10).
--
-- *** DO NOT RUN AS IS. READ THIS HEADER FIRST. ***
--
-- 1. Mike chooses the backend. api/_rpc.js sends every pairing RPC to whatever
--    GLASSTUBE_SUPABASE_URL points at: Berth (api.atberth.com) when that is the
--    host, otherwise a Supabase project. Run this only against the database
--    that URL really serves in production, after a backup / copy of
--    glasstube_pairs.
--
-- 2. Review against the live definitions first. This file was written without
--    database access, so it never re-implements the existing logic: the new
--    functions CALL glasstube_poll and glasstube_ack and only add bookkeeping.
--    Before running, dump what is live and check every line marked ASSUMED:
--
--      select pg_get_functiondef(p.oid) from pg_proc p
--       where p.proname like 'glasstube\_%' order by p.proname;
--      \d glasstube_pairs
--
--    ASSUMED (fix here if the live schema differs):
--      a. glasstube_pairs has a column `code` (the 6-character code, stored in
--         upper case) and `link_token` (64 hex, named in HANDOFF.md).
--      b. The push sequence number that glasstube_poll returns as destSeq is
--         stored in a column `dest_seq`.
--      c. glasstube_poll(p_code text) and glasstube_ack(p_code text, p_seq <int
--         or bigint>) exist with exactly those argument names (api/pair.js
--         calls them that way today) and return json or jsonb.
--      d. Rows are found by `code = upper(p_code) or link_token = p_code`. Copy
--         the exact lookup glasstube_poll uses (including any rule for the
--         code's 24h window) into the lines marked LOOKUP if it differs.
--      e. The role the server key maps to needs EXECUTE on the new functions.
--         Copy the grants glasstube_poll has (\df+ glasstube_poll).
--
-- 3. Order of operations. The server code (api/_delivery.js) works with or
--    without this migration: until these functions exist it falls back to
--    glasstube_poll / glasstube_ack and returns today's immediate ok:true from
--    /api/push. So deploy first, run this second, and the phone starts getting
--    confirmed answers within 5 minutes (the server re-checks for the new
--    functions every 5 minutes per warm instance).
--
-- 4. Old callers keep working: nothing existing is altered or overloaded. Only
--    columns and new function names are added, and every new function has a
--    default-free signature so PostgREST / Berth resolve them unambiguously.
--
-- Rollback (all of it, nothing else depends on these):
--   drop function if exists public.glasstube_hud_poll(text, text, text);
--   drop function if exists public.glasstube_ack_state(text, integer, text, text);
--   drop function if exists public.glasstube_delivery(text);
--   drop function if exists public.glasstube_supersede(text, text);
--   alter table public.glasstube_pairs
--     drop column if exists hud_seen_at, drop column if exists hud_build,
--     drop column if exists hud_who, drop column if exists ack_seq,
--     drop column if exists ack_state, drop column if exists ack_detail,
--     drop column if exists ack_at, drop column if exists superseded_by;

begin;

-- Columns ------------------------------------------------------------------

alter table public.glasstube_pairs
  add column if not exists hud_seen_at   timestamptz,  -- last poll from the glasses (never the phone's preview)
  add column if not exists hud_build     text,         -- HUD build that polled; null = a build without delivery reports
  add column if not exists hud_who       text,         -- 'hud' or 'hud-legacy' (user-agent match, no who param)
  add column if not exists ack_seq       integer,      -- push seq the glasses last reported on
  add column if not exists ack_state     text,         -- got | hidden | missed | pinch | playing | failed
  add column if not exists ack_detail    text,         -- e.g. the sentence shown on a final error
  add column if not exists ack_at        timestamptz,
  add column if not exists superseded_by text;         -- new code, set when the glasses unlinked and re-minted

-- Row lookup (ASSUMED a, d) --------------------------------------------------
-- Every statement below finds the row with
--     (p.link_token = p_code or p.code = upper(p_code))
-- A 64-hex token can never equal a 6-character upper-case code, so the OR is
-- exact, and it can use indexes on both columns. If glasstube_poll looks rows
-- up differently, change every line marked LOOKUP to match it.

-- glasstube_hud_poll ---------------------------------------------------------
-- Exactly glasstube_poll, plus: the glasses checked in, with this build.

create or replace function public.glasstube_hud_poll(p_code text, p_build text, p_who text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := to_jsonb(public.glasstube_poll(p_code => p_code));   -- ASSUMED c
  if coalesce(v->>'ok', 'false') = 'true' then
    update public.glasstube_pairs p
       set hud_seen_at = now(),
           hud_build   = nullif(left(coalesce(p_build, ''), 40), ''),
           hud_who     = left(coalesce(nullif(p_who, ''), 'hud'), 16)
     where (p.link_token = p_code or p.code = upper(p_code));            -- LOOKUP
  end if;
  return v;
end;
$$;

-- glasstube_ack_state --------------------------------------------------------
-- Records what the glasses did with push p_seq. 'got' and 'missed' also do
-- today's consume through glasstube_ack (which only consumes when p_seq is
-- still the pending push, so a late report never eats a newer push).

create or replace function public.glasstube_ack_state(p_code text, p_seq integer, p_state text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text := lower(coalesce(nullif(p_state, ''), 'got'));
begin
  if v_state not in ('got', 'hidden', 'missed', 'pinch', 'playing', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'Unknown delivery state.');
  end if;
  if p_seq is null then
    return jsonb_build_object('ok', false, 'error', 'seq required');
  end if;
  if v_state in ('got', 'missed') then
    perform public.glasstube_ack(p_code => p_code, p_seq => p_seq);   -- ASSUMED c
  end if;
  update public.glasstube_pairs p
     set ack_seq    = p_seq,
         ack_state  = v_state,
         ack_detail = left(p_detail, 300),
         ack_at     = now()
   where (p.link_token = p_code or p.code = upper(p_code))               -- LOOKUP
     -- A 'got' that arrives after a later state for the same push must not
     -- undo it (the HUD sends them in order, but the network may not).
     and not (v_state = 'got'
              and p.ack_seq is not distinct from p_seq
              and p.ack_state is not null
              and p.ack_state <> 'got');
  return jsonb_build_object('ok', true);
end;
$$;

-- glasstube_delivery ---------------------------------------------------------
-- Read side for /api/push (and /api/pair touch, for superseded rows).

create or replace function public.glasstube_delivery(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object(
              'ok',         true,
              'hud_seen_s', case when l.hud_seen_at is null then null
                                 else greatest(0, floor(extract(epoch from now() - l.hud_seen_at)))::integer end,
              'hud_build',  l.hud_build,
              'hud_who',    l.hud_who,
              'ack_seq',    l.ack_seq,
              'ack_state',  l.ack_state,
              'ack_detail', l.ack_detail,
              'ack_age_s',  case when l.ack_at is null then null
                                 else greatest(0, floor(extract(epoch from now() - l.ack_at)))::integer end,
              'dest_seq',   l.dest_seq,                                  -- ASSUMED b
              'superseded', l.superseded_by is not null)
       from public.glasstube_pairs l
      where (l.link_token = p_code or l.code = upper(p_code))              -- LOOKUP
      order by (l.link_token = p_code) desc nulls last
      limit 1),
    jsonb_build_object('ok', false, 'missing', true))
$$;

-- glasstube_supersede --------------------------------------------------------
-- The glasses unlinked their phone and minted p_new_code. Mark the link token
-- they held as replaced, so a touch or push on it tells the phone to unpair.
-- Only ever a full 64-hex link token (unguessable, and only the glasses that
-- held it can send it), never a 6-character code.

create or replace function public.glasstube_supersede(p_old text, p_new_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if p_old is null or p_old !~ '^[A-Fa-f0-9]{64}$' or coalesce(p_new_code, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'bad arguments');
  end if;
  if not exists (select 1 from public.glasstube_pairs where code = upper(p_new_code)) then   -- ASSUMED a
    return jsonb_build_object('ok', false, 'error', 'unknown new code');
  end if;
  update public.glasstube_pairs p
     set superseded_by = upper(p_new_code)
   where p.link_token = p_old
     and p.superseded_by is null
     and p.code is distinct from upper(p_new_code);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'superseded', n);
end;
$$;

-- Grants (ASSUMED e) -----------------------------------------------------------
-- Mirror glasstube_poll. On Supabase that is anon / authenticated /
-- service_role; on Berth use whatever role its RPC gateway runs as.

revoke all on function public.glasstube_hud_poll(text, text, text) from public;
revoke all on function public.glasstube_ack_state(text, integer, text, text) from public;
revoke all on function public.glasstube_delivery(text) from public;
revoke all on function public.glasstube_supersede(text, text) from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.glasstube_hud_poll(text, text, text) to %I', r);
      execute format('grant execute on function public.glasstube_ack_state(text, integer, text, text) to %I', r);
      execute format('grant execute on function public.glasstube_delivery(text) to %I', r);
      execute format('grant execute on function public.glasstube_supersede(text, text) to %I', r);
    end if;
  end loop;
end;
$$;

commit;

-- PostgREST (Supabase) caches the function list; make it see the new ones.
notify pgrst, 'reload schema';

-- Smoke test, on a throwaway pair only (mint one with POST /api/pair first):
--   select public.glasstube_hud_poll('<CODE>', 'testbuild', 'hud');
--   select public.glasstube_delivery('<CODE>');   -- hud_seen_s 0, hud_build testbuild
--   select public.glasstube_ack_state('<CODE>', 1, 'playing', null);
--   select public.glasstube_delivery('<CODE>');   -- ack_seq 1, ack_state playing
