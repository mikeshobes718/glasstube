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

export async function channelFeed(channelId, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 6, 8));
  const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=' +
    encodeURIComponent(channelId);
  const r = await fetch(url, { headers: { accept: 'application/atom+xml' } });
  if (!r.ok) throw new Error('YouTube feed HTTP ' + r.status);
  return parseAtom(await r.text(), cap);
}

export async function playlistFeed(playlistId, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 12, 20));
  const url = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' +
    encodeURIComponent(playlistId);
  const r = await fetch(url, { headers: { accept: 'application/atom+xml' } });
  if (!r.ok) throw new Error('YouTube playlist HTTP ' + r.status);
  return parseAtom(await r.text(), cap);
}
