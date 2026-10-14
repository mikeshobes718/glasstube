import { rpc, rpcConfigured, readBody, json } from './_rpc.js';
import { BUILD } from './_build.js';
import { rpcOrLegacy, rpcIfReady, deliveryRead, DELIVERY_STATES, SUPERSEDED_TEXT } from './_delivery.js';

/* Every GET carries the deployed build (scripts/stamp.mjs). A HUD that has
   been alive on the glasses for days compares it with its own and reloads
   itself at the next safe moment, so a deploy reaches the lens on its own. */
function withBuild(out) {
  return Object.assign({}, out, { build: BUILD });
}

/* Which device is actually polling. The phone's Glasses tab shows a live
   HUD preview that polls exactly like the glasses do, so a poll alone does not
   prove the glasses are listening. The HUD sends its build (b), a per-page
   instance id (i), who it is (hud or preview) and its visibility (vis).
   Logged at most every 30s per pairing key, so one busy pair cannot hide
   another. */
const AGENT_LOG_MS = 30000;
const agentLogAt = new Map();
function noteAgent(req, code, out, fn) {
  const key = String(code).slice(0, 6);
  const now = Date.now();
  if (now - (agentLogAt.get(key) || 0) < AGENT_LOG_MS) return;
  agentLogAt.set(key, now);
  if (agentLogAt.size > 500) {
    for (const [k, t] of agentLogAt) if (now - t >= AGENT_LOG_MS) agentLogAt.delete(k);
  }
  const q = req.query || {};
  const dest = (out && out.dest) || {};
  console.log('[glasstube-poller]', JSON.stringify({
    key, len: String(code).length,
    who: String(q.who || '').slice(0, 12), b: String(q.b || '').slice(0, 16),
    i: String(q.i || '').slice(0, 12), vis: String(q.vis || '').slice(0, 8), fn,
    ok: !!(out && out.ok), paired: !!(out && out.paired), seq: out && out.destSeq,
    dest: (dest.videos && dest.videos[0] && dest.videos[0].id) || dest.id || '', hasTs: !!dest.ts,
    ua: String(req.headers['user-agent'] || '').slice(0, 60),
  }));
}

/* WP6: is this request from the glasses rather than the phone's HUD preview?
   Builds that send who say so. Builds from before that (still running on the
   glasses for days) are recognised by the glasses' WebView user agent, so the
   iPhone preview never counts as the glasses checking in. */
function fromGlasses(req, who) {
  const w = String(who || '');
  if (w) return w === 'hud';
  return /Greatwhite|Android/i.test(String(req.headers['user-agent'] || ''));
}

/* The HUD skips a push older than 10 minutes so a forgotten tab stays quiet,
   but it judged that against its own clock, and the glasses' clock is not
   ours: a skewed one made every push look old, acked and silently dropped.
   The server's clock wrote ts, so the server decides. A fresh push goes out
   without ts, which every HUD build reads as "play it". A stale one keeps ts
   for builds that still compare clocks, and every push says stale and ageS so
   a current HUD never has to: it shows a stale push as 'Missed from iPhone'. */
const PUSH_FRESH_MS = 10 * 60 * 1000;
export function judgeFresh(out) {
  const dest = out && out.dest;
  const ageMs = dest && dest.ts ? Date.now() - Number(dest.ts) : NaN;
  if (Number.isFinite(ageMs)) {
    out.dest = Object.assign({}, dest, {
      stale: ageMs >= PUSH_FRESH_MS,
      ageS: Math.max(0, Math.round(ageMs / 1000)),
    });
    if (!out.dest.stale) delete out.dest.ts;
  }
  return out;
}

export default async function handler(req, res) {
  if (!rpcConfigured()) {
    const out = { ok: false, error: 'Phone pairing is not configured on the server.' };
    return json(res, 200, req.method === 'GET' ? withBuild(out) : out);
  }
  try {
    if (req.method === 'GET') {
      const code = req.query.code;
      if (!code) return json(res, 400, withBuild({ ok: false, error: 'code required' }));
      const legacyPoll = () => rpc('glasstube_poll', { p_code: code });
      // WP6: the glasses' poll also records that they checked in, and which
      // build they run (only builds that report delivery send b).
      const glasses = fromGlasses(req, req.query.who);
      const polled = judgeFresh(glasses
        ? await rpcOrLegacy('glasstube_hud_poll', {
          p_code: code,
          p_build: String(req.query.b || '').slice(0, 40) || null,
          p_who: String(req.query.who || 'hud-legacy').slice(0, 16),
        }, legacyPoll)
        : await legacyPoll());
      noteAgent(req, code, polled, glasses ? 'hud_poll' : 'poll');
      return json(res, 200, withBuild(polled));
    }
    if (req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (body.code && body.ack != null) {
        const seq = Number(body.ack);
        // WP6: a legacy { code, ack } with no state means 'got'.
        const state = String(body.state || 'got').toLowerCase();
        const detail = String(body.detail || '').slice(0, 300);
        const glasses = fromGlasses(req, body.who);
        console.log('[glasstube-ack]', JSON.stringify({
          seq, state, who: String(body.who || '').slice(0, 12), b: String(body.b || '').slice(0, 16),
          glasses, detail: detail.slice(0, 80),
        }));
        if (DELIVERY_STATES.indexOf(state) < 0) {
          return json(res, 200, { ok: false, error: 'Unknown delivery state.' });
        }
        // Only 'got' and 'missed' consume the push, exactly like today's ack.
        const consume = state === 'got' || state === 'missed';
        const legacyAck = () => (consume
          ? rpc('glasstube_ack', { p_code: body.code, p_seq: seq })
          : Promise.resolve(null));
        // The phone's HUD preview still consumes, but never speaks for the glasses.
        if (!glasses) await legacyAck();
        else {
          await rpcOrLegacy('glasstube_ack_state', {
            p_code: body.code, p_seq: seq, p_state: state, p_detail: detail || null,
          }, legacyAck);
        }
        return json(res, 200, { ok: true });
      }
      if (body.code && body.touch) {
        // WP6: a pairing the glasses replaced with a new code tells the phone,
        // which then unpairs itself instead of pushing into a row nobody polls.
        const row = await deliveryRead(body.code, 3000);
        if (row && row.superseded) {
          return json(res, 200, { ok: false, moved: true, error: SUPERSEDED_TEXT });
        }
        return json(res, 200, await rpc('glasstube_touch', { p_code: body.code }));
      }
      const minted = await rpc('glasstube_new_pair', {});
      // WP6: the glasses unlinked and minted again, so mark their old link as
      // replaced. Only a full link token the glasses held, never a guessable code.
      const old = String(body.replaces || '');
      if (minted && minted.ok && minted.code && /^[a-f0-9]{64}$/i.test(old)) {
        const s = await rpcIfReady('glasstube_supersede', { p_old: old, p_new_code: minted.code });
        console.log('[glasstube-supersede]', JSON.stringify({
          old: old.slice(0, 6), code: minted.code, ok: !!(s && s.ok),
        }));
      }
      return json(res, 200, minted);
    }
    return json(res, 405, { ok: false, error: 'GET or POST only' });
  } catch (e) {
    const out = { ok: false, error: String((e && e.message) || e) };
    return json(res, 200, req.method === 'GET' ? withBuild(out) : out);
  }
}
