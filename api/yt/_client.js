export async function yt(sess, path, params) {
  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);
  Object.keys(params || {}).forEach(k => {
    if (params[k] != null && params[k] !== '') u.searchParams.set(k, String(params[k]));
  });
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + sess.at } });
  const d = await r.json();
  if (!r.ok) {
    const msg = (d && d.error && d.error.message) || ('YouTube HTTP ' + r.status);
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return d;
}

export async function ytPages(sess, path, params, cap) {
  const out = [];
  let pageToken = '';
  const limit = Math.max(1, Math.min(Number(cap) || 50, 150));
  while (out.length < limit) {
    const d = await yt(sess, path, Object.assign({}, params, {
      pageToken,
      maxResults: String(Math.min(50, limit - out.length)),
    }));
    (d.items || []).forEach(item => out.push(item));
    pageToken = d.nextPageToken || '';
    if (!pageToken) break;
  }
  return out.slice(0, limit);
}

export function slimVideo(item) {
  const id = (item && item.snippet && item.snippet.resourceId && item.snippet.resourceId.videoId) ||
    (item && item.contentDetails && item.contentDetails.videoId) ||
    (item && item.id && item.id.videoId) ||
    (item && item.id) ||
    '';
  const sn = (item && item.snippet) || {};
  const title = String(sn.title || 'YouTube video');
  if (!id || /private video|deleted video/i.test(title)) return null;
  const thumbs = sn.thumbnails || {};
  const thumb = (thumbs.medium && thumbs.medium.url) ||
    (thumbs.high && thumbs.high.url) ||
    (thumbs.default && thumbs.default.url) ||
    ('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg');
  return {
    id: String(id),
    title: title.slice(0, 120),
    channel: String(sn.videoOwnerChannelTitle || sn.channelTitle || '').slice(0, 80),
    thumb,
    url: 'https://youtu.be/' + id,
  };
}

export function parseIsoDuration(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  if (!h && !min && !s) return '';
  if (h) return h + ':' + String(min).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return min + ':' + String(s).padStart(2, '0');
}

export function fmtViews(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return '';
  if (x >= 1e9) return trimDec(x / 1e9) + 'B views';
  if (x >= 1e6) return trimDec(x / 1e6) + 'M views';
  if (x >= 1e3) return trimDec(x / 1e3) + 'K views';
  return x + (x === 1 ? ' view' : ' views');
}

function trimDec(n) {
  const t = n >= 10 ? String(Math.round(n)) : n.toFixed(1);
  return t.replace(/\.0$/, '');
}

export function fmtWhen(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 3600) return 'just now';
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }
  if (sec < 86400 * 30) {
    const d = Math.floor(sec / 86400);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  if (sec < 86400 * 365) {
    const mo = Math.floor(sec / (86400 * 30));
    return mo + (mo === 1 ? ' month ago' : ' months ago');
  }
  const y = Math.floor(sec / (86400 * 365));
  return y + (y === 1 ? ' year ago' : ' years ago');
}

export async function enrichVideos(sess, videos) {
  const list = (videos || []).filter(v => v && v.id);
  if (!list.length) return videos || [];
  const d = await yt(sess, 'videos', {
    part: 'contentDetails,statistics,snippet,status',
    id: list.map(v => v.id).join(','),
  });
  const byId = {};
  (d.items || []).forEach(item => { if (item && item.id) byId[item.id] = item; });
  return list.map(v => {
    const full = byId[v.id];
    if (!full) return null;
    const liveState = String((full.snippet && full.snippet.liveBroadcastContent) || '');
    const live = liveState === 'live';
    const upcoming = liveState === 'upcoming';
    const embeddable = !(full.status && full.status.embeddable === false);
    const duration = live ? 'LIVE' : (upcoming ? 'Soon' : parseIsoDuration(full.contentDetails && full.contentDetails.duration));
    const views = live || upcoming ? '' : fmtViews(full.statistics && full.statistics.viewCount);
    const when = fmtWhen(full.snippet && full.snippet.publishedAt);
    const bits = [];
    if (live) bits.push('Live');
    else if (upcoming) bits.push('Upcoming');
    else if (duration) bits.push(duration);
    if (views) bits.push(views);
    if (when) bits.push(when);
    return Object.assign({}, v, {
      duration: duration || '',
      views: views || '',
      when: when || '',
      live: live,
      upcoming: upcoming,
      embeddable: embeddable,
      meta: bits.join(' · '),
    });
  }).filter(v => v && v.id && v.embeddable !== false && !v.upcoming);
}

export async function playlistVideos(sess, playlistId, cap) {
  const items = await ytPages(sess, 'playlistItems', {
    part: 'snippet,contentDetails',
    playlistId,
  }, cap || 20);
  const videos = items.map(slimVideo).filter(Boolean);
  try {
    return await enrichVideos(sess, videos);
  } catch (e) {
    return videos;
  }
}
