/* YouTube search without a Google sign-in.

   The glasses have no keyboard and no cookie jar worth signing into, so the
   HUD needs a search that works from a bare page. This reads the same
   ytInitialData blob the watch page ships to browsers. If YouTube ever stops
   answering Vercel's IPs, /api/yt/search (Google Data API, needs the phone's
   session) is still there as the signed-in path. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/* sp=EgIQAQ%3D%3D is "videos only" - no channels, playlists or shelves. */
const VIDEOS_ONLY = 'EgIQAQ%3D%3D';
const MAX_HITS = 24;

const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;

function initialData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ||
    html.match(/ytInitialData"\]\s*=\s*(\{.+?\});/s) ||
    html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function textOf(node) {
  if (!node) return '';
  if (node.simpleText) return String(node.simpleText);
  if (Array.isArray(node.runs)) return node.runs.map(r => String(r.text || '')).join('');
  return '';
}

function secondsOf(label) {
  const parts = String(label || '').split(':').map(n => Number(n));
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/* videoRenderer turns up at different depths depending on which shelf YouTube
   decided to show, so walk the whole tree instead of guessing the path. */
function collect(data, cap) {
  const out = [];
  const seen = Object.create(null);
  const stack = [data];
  while (stack.length && out.length < cap) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const v = node.videoRenderer;
    if (v && v.videoId && !seen[v.videoId]) {
      seen[v.videoId] = true;
      const length = textOf(v.lengthText);
      const badges = []
        .concat(v.badges || [])
        .map(b => textOf(b && b.metadataBadgeRenderer && b.metadataBadgeRenderer.label))
        .filter(Boolean);
      const live = /live/i.test(badges.join(' ')) || (!length && !!v.publishedTimeText === false);
      out.push({
        id: String(v.videoId),
        title: textOf(v.title).slice(0, 120),
        channel: (textOf(v.ownerText) || textOf(v.longBylineText)).slice(0, 80),
        thumb: 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg',
        duration: live ? 'LIVE' : length,
        seconds: secondsOf(length),
        views: textOf(v.shortViewCountText),
        when: textOf(v.publishedTimeText),
        live: !!live,
      });
    }
    for (const k in node) {
      if (k === 'videoRenderer') continue;
      const child = node[k];
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return out;
}

function withMeta(videos) {
  return videos.map(v => {
    const bits = [];
    if (v.duration) bits.push(v.duration);
    if (v.views) bits.push(v.views);
    if (v.when) bits.push(v.when);
    return Object.assign({}, v, { meta: bits.join(' · ') });
  });
}

export async function searchYouTube(query, limit) {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return { ok: false, error: 'Type something to search.' };
  const cap = Math.max(1, Math.min(Number(limit) || 12, MAX_HITS));
  const key = q.toLowerCase() + '|' + cap;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.body;

  const url = 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(q) + '&sp=' + VIDEOS_ONLY;
  const r = await fetch(url, {
    headers: {
      'user-agent': UA,
      'accept-language': 'en-US,en;q=0.9',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!r.ok) throw new Error('YouTube search HTTP ' + r.status);
  const data = initialData(await r.text());
  if (!data) throw new Error('YouTube changed the search page');
  const videos = withMeta(collect(data, cap));
  const body = { ok: true, q, videos };
  if (videos.length) cache.set(key, { body, exp: Date.now() + CACHE_MS });
  return body;
}
