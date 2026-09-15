const VIDEO_RE = /^[a-zA-Z0-9_-]{11}$/;
const CHANNEL_RE = /^UC[a-zA-Z0-9_-]{20,}$/;

export function parseYouTube(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  let m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (m) return { kind: 'video', id: m[1] };

  m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (m) return { kind: 'video', id: m[1] };

  m = s.match(/\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})/);
  if (m) return { kind: 'video', id: m[1] };

  m = s.match(/ytimg\.com\/vi\/([a-zA-Z0-9_-]{11})\//);
  if (m) return { kind: 'video', id: m[1] };

  m = s.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/);
  if (m) return { kind: 'channel', id: m[1] };

  m = s.match(/youtube\.com\/@([A-Za-z0-9._-]+)/);
  if (m) return { kind: 'handle', handle: m[1] };

  if (s.charAt(0) === '@') {
    const handle = s.slice(1).split(/[/?#]/)[0];
    if (handle) return { kind: 'handle', handle: handle };
  }

  const list = s.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  const hasVid = /[?&]v=/.test(s) || /youtu\.be\/[a-zA-Z0-9_-]{11}/.test(s);
  if (list && !hasVid) return { kind: 'playlist', id: list[1] };

  if (VIDEO_RE.test(s) && !s.startsWith('UC')) return { kind: 'video', id: s };
  if (CHANNEL_RE.test(s)) return { kind: 'channel', id: s };
  return null;
}

export function watchUrl(id) {
  return 'https://www.youtube.com/watch?v=' + id;
}

export async function oembed(id) {
  const url = 'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent(watchUrl(id));
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  const d = await r.json();
  return {
    id,
    title: String(d.title || 'YouTube video').slice(0, 120),
    channel: String(d.author_name || '').slice(0, 80),
    thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg',
  };
}

export async function keepPlayable(videos) {
  const list = (videos || []).filter(v => v && v.id);
  if (!list.length) return [];
  const rows = await Promise.all(list.map(async (v) => {
    try {
      const meta = await oembed(v.id);
      if (!meta) return { ok: false, net: false, video: null };
      return {
        ok: true,
        net: false,
        video: Object.assign({}, v, {
          title: (v.title && v.title !== 'YouTube video') ? v.title : meta.title,
          channel: v.channel || meta.channel,
          thumb: v.thumb || meta.thumb,
        }),
      };
    } catch (e) {
      return { ok: true, net: true, video: v };
    }
  }));
  const kept = rows.filter(r => r.ok && r.video).map(r => r.video);
  if (kept.length) return kept;
  if (rows.every(r => !r.net)) return [];
  return list;
}

export async function resolveHandle(handle) {
  const r = await fetch('https://www.youtube.com/@' + encodeURIComponent(handle), {
    headers: { 'user-agent': 'Mozilla/5.0 GlassTube' },
  });
  if (!r.ok) return null;
  const html = await r.text();
  const m = html.match(/rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/) ||
    html.match(/property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/) ||
    html.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/) ||
    html.match(/"browseId":"(UC[a-zA-Z0-9_-]+)"/) ||
    html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/) ||
    html.match(/channel_id=(UC[a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseAtom(xml, cap) {
  const channel = decodeXml((xml.match(/<author>\s*<name>([^<]+)<\/name>/) || [])[1] || '');
  const feedTitle = decodeXml((xml.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
  const videos = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) && videos.length < cap) {
    const entry = m[1];
    const id = (entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    if (!id || !VIDEO_RE.test(id)) continue;
    const title = decodeXml((entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Video');
    const seconds = Number((entry.match(/seconds="(\d+)"/) || [])[1] || 0);
    videos.push({
      id,
      title: title.slice(0, 120),
      channel: channel.slice(0, 80),
      thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
      seconds: seconds || 0,
    });
  }
  return { channel: channel.slice(0, 80), title: feedTitle.slice(0, 120), videos };
}

/* YouTube's Atom feeds answer 404 and 500 in bursts - the same channel id
   fails several times in a row and then works fine for a hundred calls. It is
   rate limiting by IP, not a missing channel, so three quick retries are not
   enough on their own.

   The thing that actually makes Channels reliable is the cache underneath:
   once a feed has been read successfully, a later burst of 404s serves the
   last good copy instead of an error. A channel list that is twenty minutes
   stale beats one that says "could not load that channel". */
const FEED_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const FEED_FRESH_MS = 10 * 60 * 1000;
const FEED_STALE_MS = 24 * 60 * 60 * 1000;
const feedCache = new Map();

async function atom(url, cap, label) {
  const hit = feedCache.get(url);
  if (hit && hit.at > Date.now() - FEED_FRESH_MS) return parseAtom(hit.xml, cap);

  let last = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 300 * attempt));
    let r;
    try {
      r = await fetch(url, {
        headers: { accept: 'application/atom+xml', 'user-agent': FEED_UA },
      });
    } catch (e) {
      last = 0;
      continue;
    }
    if (r.ok) {
      const xml = await r.text();
      feedCache.set(url, { xml, at: Date.now() });
      return parseAtom(xml, cap);
    }
    last = r.status;
    // A real "no such channel" is stable; retrying it just wastes time.
    if (r.status === 400 || r.status === 403) break;
  }

  if (hit && hit.at > Date.now() - FEED_STALE_MS) return parseAtom(hit.xml, cap);
  throw new Error(label + ' HTTP ' + (last || 'unreachable'));
}

/* Second route for a channel's videos, used when the Atom feed is in one of
   its 404 moods. It reads the channel page the way /api/search reads the
   results page, and it actually carries more than the feed does - durations
   and view counts, which Atom has never had.

   YouTube moved this grid to "lockupViewModel" some time before Sept 2026;
   the older videoRenderer shape is still handled so an A/B rollout cannot
   break it. */
function deepCollect(root, key, cap) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < cap) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]);
      continue;
    }
    if (n[key]) out.push(n[key]);
    for (const k in n) {
      if (n[k] && typeof n[k] === 'object') stack.push(n[k]);
    }
  }
  return out;
}

function initialData(html) {
  const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ||
    html.match(/ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function durationSeconds(label) {
  const parts = String(label || '').split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function fromLockups(data, channel, cap) {
  const videos = [];
  const seen = Object.create(null);
  for (const lock of deepCollect(data, 'lockupViewModel', cap * 4)) {
    const id = lock && lock.contentId;
    if (!id || !VIDEO_RE.test(id) || seen[id]) continue;
    const meta = (lock.metadata && lock.metadata.lockupMetadataViewModel) || {};
    const title = (meta.title && meta.title.content) || '';
    if (!title) continue;
    seen[id] = true;
    const badge = deepCollect(lock.contentImage || {}, 'thumbnailBadgeViewModel', 12)
      .map(b => String((b && b.text) || ''))
      .find(t => /^\d+:\d\d/.test(t)) || '';
    const bits = deepCollect(meta, 'metadataParts', 12).flat()
      .map(p => p && p.text && p.text.content)
      .filter(Boolean);
    videos.push({
      id,
      title: title.slice(0, 120),
      channel: channel.slice(0, 80),
      thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
      seconds: durationSeconds(badge),
      duration: badge,
      meta: [badge].concat(bits).filter(Boolean).join(' · ').slice(0, 80),
    });
    if (videos.length >= cap) break;
  }
  return videos;
}

function fromVideoRenderers(data, channel, cap) {
  const videos = [];
  const seen = Object.create(null);
  for (const v of deepCollect(data, 'videoRenderer', cap * 4)) {
    const id = v && v.videoId;
    if (!id || !VIDEO_RE.test(id) || seen[id]) continue;
    seen[id] = true;
    const title = (v.title && (v.title.simpleText ||
      (v.title.runs || []).map(r => r.text).join(''))) || '';
    const dur = (v.lengthText && v.lengthText.simpleText) || '';
    const views = (v.shortViewCountText && v.shortViewCountText.simpleText) || '';
    const when = (v.publishedTimeText && v.publishedTimeText.simpleText) || '';
    videos.push({
      id,
      title: String(title).slice(0, 120),
      channel: channel.slice(0, 80),
      thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
      seconds: durationSeconds(dur),
      duration: dur,
      meta: [dur, views, when].filter(Boolean).join(' · ').slice(0, 80),
    });
    if (videos.length >= cap) break;
  }
  return videos;
}

export async function channelPage(ref, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 6, 30));
  const path = CHANNEL_RE.test(ref) ? 'channel/' + ref : '@' + String(ref).replace(/^@/, '');
  const r = await fetch('https://www.youtube.com/' + path + '/videos', {
    headers: { 'user-agent': FEED_UA, 'accept-language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error('YouTube channel HTTP ' + r.status);
  const html = await r.text();
  const data = initialData(html);
  if (!data) throw new Error('YouTube changed the channel page');
  const channel = decodeXml((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || '');
  const id = (html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/) || [])[1] ||
    (html.match(/"externalId":"(UC[a-zA-Z0-9_-]+)"/) || [])[1] || '';
  const videos = fromLockups(data, channel, cap);
  return {
    id,
    channel,
    title: channel,
    videos: videos.length ? videos : fromVideoRenderers(data, channel, cap),
  };
}

export async function channelFeed(channelId, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 6, 8));
  try {
    return await atom(
      'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(channelId),
      cap,
      'YouTube feed'
    );
  } catch (e) {
    // The feed is having one of its moments. Read the page instead.
    const page = await channelPage(channelId, cap);
    if (!page.videos.length) throw e;
    return page;
  }
}

export async function playlistFeed(playlistId, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 12, 20));
  return atom(
    'https://www.youtube.com/feeds/videos.xml?playlist_id=' + encodeURIComponent(playlistId),
    cap,
    'YouTube playlist'
  );
}
