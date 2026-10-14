import { rpc, rpcConfigured, readBody, json } from './_rpc.js';
import { BUILD } from './_build.js';

/* Every GET carries the deployed build (scripts/stamp.mjs). A HUD that has
   been alive on the glasses for days compares it with its own and reloads
   itself at the next safe moment, so a deploy reaches the lens on its own. */
function withBuild(out) {
  return Object.assign({}, out, { build: BUILD });
}

/* Which device is actually polling. The phone's Glasses tab shows a live
   HUD preview that polls exactly like the glasses do, so a poll alone does not
   prove the glasses are listening. The HUD sends its build (b), a per-page
   instance id (i) and who it is (hud or preview). Logged at most every 30s per
   pairing key, so one busy pair cannot hide another. */
const POLL_LOG_MS = 30000;
const lastUaLog = new Map();
function noteAgent(req, code, out) {
  const key = String(code).slice(0, 6);
  const now = Date.now();
  if (now - (lastUaLog.get(key) || 0) < POLL_LOG_MS) return;
  if (lastUaLog.size > 500) {
    for (const [k, at] of lastUaLog) if (now - at >= POLL_LOG_MS) lastUaLog.delete(k);
  }
  lastUaLog.set(key, now);
  const q = req.query || {};
  const dest = (out && out.dest) || {};
  console.log('[glasstube-poller]', JSON.stringify({
    key, len: String(code).length,
    b: String(q.b || '').slice(0, 16), i: String(q.i || '').slice(0, 8), who: String(q.who || '').slice(0, 8),
    ok: !!(out && out.ok), paired: !!(out && out.paired), seq: out && out.destSeq,
    dest: (dest.videos && dest.videos[0] && dest.videos[0].id) || dest.id || '', hasTs: !!dest.ts,
    ua: String(req.headers['user-agent'] || '').slice(0, 60),
  }));
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
      const polled = judgeFresh(await rpc('glasstube_poll', { p_code: code }));
      noteAgent(req, code, polled);
      return json(res, 200, withBuild(polled));
    }
    if (req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (body.code && body.ack != null) {
        console.log('[glasstube-ack]', JSON.stringify({ seq: Number(body.ack) }));
        await rpc('glasstube_ack', { p_code: body.code, p_seq: Number(body.ack) });
        return json(res, 200, { ok: true });
      }
      if (body.code && body.touch) {
        return json(res, 200, await rpc('glasstube_touch', { p_code: body.code }));
      }
      return json(res, 200, await rpc('glasstube_new_pair', {}));
    }
    return json(res, 405, { ok: false, error: 'GET or POST only' });
  } catch (e) {
    const out = { ok: false, error: String((e && e.message) || e) };
    return json(res, 200, req.method === 'GET' ? withBuild(out) : out);
  }
}
