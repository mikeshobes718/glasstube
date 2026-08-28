import { json } from './_rpc.js';
import { parseYouTube, resolveHandle, channelFeed } from './_yt.js';

export default async function handler(req, res) {
  const q = req.query || {};
  const raw = String(q.url || q.handle || q.channel || q.q || '').trim();
  if (!raw) return json(res, 200, { ok: false, error: 'channel required' });

  const parsed = parseYouTube(raw);
  if (!parsed) {
    return json(res, 200, { ok: false, error: 'That does not look like a YouTube channel.' });
  }
  if (parsed.kind === 'video') {
    return json(res, 200, {
      ok: false,
      error: 'That is a video link. Use Send, or paste the channel page instead.',
    });
  }
  if (parsed.kind === 'playlist') {
    return json(res, 200, { ok: false, error: 'That is a playlist. Add it under Playlists.' });
  }

  try {
    let id = parsed.id;
    if (parsed.kind === 'handle') {
      id = await resolveHandle(parsed.handle);
      if (!id) return json(res, 200, { ok: false, error: 'Could not find that @name.' });
    }
    const limit = Math.max(1, Math.min(Number(q.limit) || 6, 8));
    const feed = await channelFeed(id, limit);
    return json(res, 200, {
      ok: true,
      id,
      name: String(feed.channel || parsed.handle || 'Channel').slice(0, 80),
      url: 'https://www.youtube.com/channel/' + id,
      videos: feed.videos,
    });
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
