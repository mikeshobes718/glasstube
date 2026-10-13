import { rpc, rpcConfigured, readBody, json } from './_rpc.js';

/* Which device is actually polling. The phone's Glasses tab shows a live
   HUD preview that polls exactly like the glasses do, so a poll alone does not
   prove the glasses are listening. Logged at most every 30s per instance. */
let lastUaLog = 0;
function noteAgent(req, code, out) {
  if (Date.now() - lastUaLog < 30000) return;
  lastUaLog = Date.now();
  const dest = (out && out.dest) || {};
  console.log('[glasstube-poller]', JSON.stringify({
    key: String(code).slice(0, 6), len: String(code).length,
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
    return json(res, 200, { ok: false, error: 'Phone pairing is not configured on the server.' });
  }
  try {
    if (req.method === 'GET') {
      const code = req.query.code;
      if (!code) return json(res, 400, { ok: false, error: 'code required' });
      const polled = judgeFresh(await rpc('glasstube_poll', { p_code: code }));
      noteAgent(req, code, polled);
      return json(res, 200, polled);
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
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
