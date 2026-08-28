import { loadSession, withSession, needAuth } from '../auth/_google.js';
import { json } from '../_rpc.js';
import { playlistVideos } from './_client.js';

export default async function handler(req, res) {
  try {
    const { sess, token, rotated } = await loadSession(req);
    if (!sess) return needAuth(res);
    const id = String((req.query && req.query.id) || '').trim();
    if (!id) return json(res, 200, { ok: false, error: 'playlist id required' });
    const videos = await playlistVideos(sess, id, 20);
    return withSession(res, { ok: true, id, videos }, token, rotated);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/invalid|expired|unauth|revoked/i.test(msg)) return needAuth(res);
    return json(res, 200, { ok: false, error: msg });
  }
}
