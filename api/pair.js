import { rpc, rpcConfigured, readBody, json } from './_rpc.js';

export default async function handler(req, res) {
  if (!rpcConfigured()) {
    return json(res, 200, { ok: false, error: 'Phone pairing is not configured on the server.' });
  }
  try {
    if (req.method === 'GET') {
      const code = req.query.code;
      if (!code) return json(res, 400, { ok: false, error: 'code required' });
      return json(res, 200, await rpc('glasstube_poll', { p_code: code }));
    }
    if (req.method === 'POST') {
      const body = (await readBody(req)) || {};
      if (body.code && body.ack != null) {
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
