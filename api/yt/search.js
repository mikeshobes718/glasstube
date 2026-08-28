import { loadSession, withSession, needAuth } from '../auth/_google.js';
import { json } from '../_rpc.js';
import { yt, slimVideo, enrichVideos } from './_client.js';

export default async function handler(req, res) {
  try {
    const { sess, token, rotated } = await loadSession(req);
    if (!sess) return needAuth(res);
    const q = String((req.query && (req.query.q || req.query.query)) || '').trim();
    if (!q) return json(res, 200, { ok: false, error: 'Type something to search.' });
    const d = await yt(sess, 'search', {
      part: 'snippet',
      q,
      type: 'video',
      maxResults: '12',
    });
    let videos = (d.items || []).map(item => {
      const v = slimVideo(item);
      if (!v) return null;
      if (!v.channel) v.channel = String((item.snippet && item.snippet.channelTitle) || '');
      return v;
    }).filter(Boolean);
    try { videos = await enrichVideos(sess, videos); } catch (e) {}
    return withSession(res, { ok: true, videos }, token, rotated);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/invalid|expired|unauth|revoked/i.test(msg)) return needAuth(res);
    return json(res, 200, { ok: false, error: msg });
  }
}
