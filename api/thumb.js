import { parseYouTube, playlistFeed } from './_yt.js';

const VIDEO_RE = /^[a-zA-Z0-9_-]{11}$/;

async function jpg(url) {
  const r = await fetch(url, { headers: { accept: 'image/jpeg,image/*' } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 80) return null;
  return buf;
}

export default async function handler(req, res) {
  const q = req.query || {};
  const raw = String(q.url || q.v || q.id || '').trim();
  let id = '';
  const parsed = parseYouTube(raw);
  if (parsed && parsed.kind === 'video') id = parsed.id;
  if (!id && parsed && parsed.kind === 'playlist') {
    try {
      const feed = await playlistFeed(parsed.id, 1);
      id = (feed.videos[0] && feed.videos[0].id) || '';
    } catch (e) { id = ''; }
  }
  if (!id && VIDEO_RE.test(raw) && raw.indexOf('UC') !== 0) id = raw;

  const tries = id ? [
    'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
    'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
    'https://i.ytimg.com/vi/' + id + '/0.jpg',
  ] : [];

  try {
    for (let i = 0; i < tries.length; i++) {
      const buf = await jpg(tries[i]);
      if (!buf) continue;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(buf);
    }
  } catch (e) { /* fall through to icon */ }

  res.setHeader('Location', '/icon-192.png?v=2');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(302).end();
}
