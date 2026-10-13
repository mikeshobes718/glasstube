import { rpc } from './_rpc.js';

/* WP6: server-confirmed delivery.

   The glasses report what happened to each push (got, hidden, missed, pinch,
   playing, failed) and every HUD poll records when the glasses last checked
   in. /api/push reads that back so the phone says "Playing on your glasses"
   only when the glasses say so.

   All of it rides on four new database functions (scripts/sql/2026-10-delivery.sql):
   glasstube_hud_poll, glasstube_ack_state, glasstube_delivery and
   glasstube_supersede. Until that migration runs they do not exist, and this
   file is what keeps the deploy a no-op: every call falls back to the legacy
   RPC (or to today's behaviour), and once a function is known to be missing
   the miss is remembered for a few minutes so each request does not pay for a
   failing round trip. Helpers start with an underscore so this file is not
   one of the 12 serverless functions. */

const MISSING_MS = 5 * 60 * 1000;
const STRIKES = 3;

// What a missing function looks like: PostgREST says PGRST202 / "Could not
// find the function ... in the schema cache", plain Postgres says 42883
// "function ... does not exist", and a gateway with no JSON body gives
// "rpc HTTP 404". A missing column (half-run migration) says "does not exist"
// too, which should also send us back to legacy.
const MISSING_RE = /could not find the function|does not exist|schema cache|PGRST202|42883|no such function|unknown (?:rpc|function)|rpc HTTP 404/i;

let missingUntil = 0;
let missingWhy = '';
let strikes = 0;

function errText(e) {
  return String((e && e.message) || e || '');
}

export function deliveryReady() {
  return Date.now() >= missingUntil;
}

export function deliveryStatus() {
  return { ready: deliveryReady(), why: missingWhy, strikes };
}

/* Test hook: forget what this instance learned about the backend. */
export function deliveryReset() {
  missingUntil = 0;
  missingWhy = '';
  strikes = 0;
}

function markMissing(why) {
  missingUntil = Date.now() + MISSING_MS;
  missingWhy = String(why || '').slice(0, 160);
  strikes = 0;
  console.log('[glasstube-delivery]', JSON.stringify({ legacyForS: MISSING_MS / 1000, why: missingWhy }));
}

/* A failure that is not obviously "function missing" (a gateway that hides
   the reason, say) only counts once it repeats while the legacy path keeps
   working, so a single blip never switches delivery off. */
function noteFailure(name, e) {
  const msg = errText(e);
  if (MISSING_RE.test(msg)) {
    markMissing(name + ': ' + msg);
    return;
  }
  strikes += 1;
  if (strikes >= STRIKES) markMissing(name + ' failed ' + STRIKES + 'x: ' + msg);
}

function noteSuccess() {
  strikes = 0;
}

function withTimeout(promise, ms) {
  let timer = null;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('delivery rpc timed out')), Math.max(1, ms));
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/* Call a WP6 function; when it is missing or fails, answer with legacy()
   instead. legacy() errors propagate unchanged, so a real backend outage
   still reads exactly as it does today. */
export async function rpcOrLegacy(name, args, legacy) {
  if (deliveryReady()) {
    try {
      const out = await rpc(name, args);
      noteSuccess();
      return out;
    } catch (e) {
      noteFailure(name, e);
    }
  }
  return legacy();
}

/* Call a WP6 function that has no legacy twin. Never throws: null means
   "unknown", and the caller then does exactly what it did before WP6. */
export async function rpcIfReady(name, args, timeoutMs) {
  if (!deliveryReady()) return null;
  try {
    const out = await withTimeout(rpc(name, args), timeoutMs || 4000);
    noteSuccess();
    return out;
  } catch (e) {
    if (/timed out/.test(errText(e))) return null;
    noteFailure(name, e);
    return null;
  }
}

/* glasstube_delivery, normalised. null when the backend cannot say. */
export async function deliveryRead(code, timeoutMs) {
  const d = await rpcIfReady('glasstube_delivery', { p_code: code }, timeoutMs);
  if (!d || typeof d !== 'object' || d.ok === false) return null;
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    seenS: num(d.hud_seen_s),
    build: d.hud_build ? String(d.hud_build) : null,
    who: d.hud_who ? String(d.hud_who) : null,
    ackSeq: num(d.ack_seq),
    ackState: d.ack_state ? String(d.ack_state) : null,
    ackDetail: d.ack_detail ? String(d.ack_detail) : '',
    destSeq: num(d.dest_seq),
    superseded: !!d.superseded,
  };
}

/* ---- What the glasses may report, and what the phone is told. ---- */

export const DELIVERY_STATES = ['got', 'hidden', 'missed', 'pinch', 'playing', 'failed'];
// States that settle a push for /api/push. 'got' alone means "keep waiting".
export const SETTLED = { playing: 1, pinch: 1, failed: 1, hidden: 1, missed: 1 };
export const SEEN_STALE_S = 45;

// Store.reconnect on the iPhone (and phone.html) unpair on 'not active', so
// this one sentence is meant to unpair. No other sentence here may contain
// 'expired' or 'not active'.
export const SUPERSEDED_TEXT = 'This link is not active any more. Your glasses were linked to a new code. ' +
  'Type the code shown on the glasses.';

export function agoText(s) {
  if (s === null || s === undefined) return '';
  if (s < 90) return 'about a minute';
  if (s < 3600) return Math.round(s / 60) + ' min';
  if (s < 48 * 3600) return Math.round(s / 3600) + ' h';
  return Math.round(s / 86400) + ' days';
}

export function notCheckedInText(seenS) {
  return seenS === null || seenS === undefined
    ? 'Saved, but your glasses have not checked in yet. Open GlassTube on the glasses and it will start.'
    : 'Saved, but your glasses have not checked in for ' + agoText(seenS) +
      '. Open GlassTube on the glasses and it will start.';
}

/* One sentence for the phone's banner. ok:true only on a confirmed play. */
export function deliveryVerdict(state, detail) {
  const why = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  switch (state) {
    case 'playing':
      return { ok: true };
    case 'pinch':
      return { ok: false, error: 'It is on your glasses. Pinch to start it.' };
    case 'failed':
      return { ok: false, error: why ? 'Your glasses could not play it: ' + why : 'Your glasses could not play it.' };
    case 'hidden':
      return { ok: false, error: 'Your glasses got it. It starts when you look at GlassTube.' };
    case 'missed':
      return { ok: false, error: 'Your glasses got it late, so it waits on their Home screen under Missed from iPhone.' };
    case 'got':
      return { ok: false, error: 'Your glasses got it and are still starting it.' };
    default:
      return { ok: false, error: 'Not picked up yet. Is GlassTube open on the glasses?' };
  }
}
