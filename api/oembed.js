import { json } from './_rpc.js';
import { parseYouTube, oembed } from './_yt.js';

export default async function handler(req, res) {
  const raw = String((req.query && (req.query.url || req.query.v)) || '').trim();
  const parsed = parseYouTube(raw);
  if (!parsed || parsed.kind !== 'video') {
    return json(res, 200, { ok: false, error: 'video id required' });
  }
  try {
    const video = await oembed(parsed.id);
    if (!video) return json(res, 200, { ok: false, error: 'Video not found or cannot be embedded.' });
    return json(res, 200, Object.assign({ ok: true }, video));
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
