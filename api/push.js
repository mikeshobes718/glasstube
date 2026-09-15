import { rpc, rpcConfigured, readBody, json } from './_rpc.js';
import { parseYouTube, oembed, keepPlayable, resolveHandle, channelFeed, playlistFeed } from './_yt.js';

const VIDEO_RE = /^[a-zA-Z0-9_-]{11}$/;
const MAX_PLAYLIST = 20;

function isGoogleFile(u) {
  return /^https:\/\/[a-z0-9.-]*googlevideo\.com\//i.test(u) &&
    /videoplayback/i.test(u) &&
    /[?&]itag=(18|22)(?:&|$)/.test(u) &&
    u.length >= 100;
}

function isRelayFile(u) {
  return /^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d+\/s\/[a-zA-Z0-9_-]{11}$/.test(u);
}

/* Two delivery routes, kept apart on purpose.

   u  the googlevideo file itself. HTTPS, so the HUD can play it inline without
      tripping mixed content, and it keeps working after the phone sleeps. Only
      valid from the public IP that resolved it, which is the phone's - and the
      glasses share that IP whenever they share the phone's WiFi.
   r  the phone's own LAN relay. Plain HTTP, so the HUD cannot load it inline;
      it is the escape hatch for when u is refused, and costs a jump out of the
      HUD to the phone's play page. */
function slim(video) {
  const row = {
    id: video.id,
    title: String(video.title || 'YouTube video').slice(0, 120),
    channel: String(video.channel || '').slice(0, 80),
    thumb: video.thumb || ('https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'),
  };
  if (video.duration) row.duration = String(video.duration).slice(0, 12);
  if (video.meta) row.meta = String(video.meta).slice(0, 80);
  const u = String(video.u || '');
  const r = String(video.r || '');
  if (isGoogleFile(u)) row.u = u.slice(0, 4000);
  else if (isRelayFile(u)) row.r = u;
  if (!row.r && isRelayFile(r)) row.r = r;
  return row;
}

async function resolveOne(raw) {
  const parsed = parseYouTube(raw);
  if (!parsed) return null;

  if (parsed.kind === 'playlist') {
    const feed = await playlistFeed(parsed.id, MAX_PLAYLIST);
    const videos = await keepPlayable((feed.videos || []).map(slim));
    return {
      list: true,
      name: feed.title || 'Playlist',
      videos,
    };
  }

  if (parsed.kind === 'video') {
    const video = await oembed(parsed.id);
    if (!video) return null;
    return { list: false, video: slim(video) };
  }

  let channelId = parsed.id;
  if (parsed.kind === 'handle') {
    channelId = await resolveHandle(parsed.handle);
    if (!channelId) return null;
  }
  const feed = await channelFeed(channelId, 1);
  const video = feed.videos[0] || null;
  if (!video) return null;
  if (!video.channel && feed.channel) video.channel = feed.channel;
  return { list: false, video: slim(video) };
}

function pack(videos, name, app) {
  const first = videos[0];
  return Object.assign({}, first, {
    playlist: name || (videos.length > 1 ? 'Playlist' : ''),
    videos,
    app: String(app || '').slice(0, 24),
    ts: Date.now(),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });
  if (!rpcConfigured()) {
    return json(res, 200, { ok: false, error: 'Phone pairing is not configured on the server.' });
  }
  const body = (await readBody(req)) || {};
  const code = String(body.code || '').trim();
  const raw = String(body.url || body.q || '').trim();
  const incoming = Array.isArray(body.videos) ? body.videos : null;
  const channels = Array.isArray(body.channels) ? body.channels : null;
  const openChannel = body.openChannel || null;
  if (!code) return json(res, 200, { ok: false, error: 'Pairing code required' });
  if (body.kind !== 'session' &&
      !channels && !(openChannel && openChannel.id) && !raw && !(incoming && incoming.length)) {
    return json(res, 200, { ok: false, error: 'Paste a YouTube link or send a playlist' });
  }

  try {
    if (body.kind === 'session') {
      const blob = String(body.session || '');
      const out = await rpc('glasstube_push', {
        p_code: code,
        p_video: { kind: 'session', session: blob, ts: Date.now() },
      });
      return json(res, 200, Object.assign({ ok: true }, out, { kind: 'session' }));
    }

    if (channels) {
      const list = channels.slice(0, 24).map(c => ({
        name: String((c && c.name) || 'Channel').slice(0, 80),
        id: String((c && c.id) || ''),
      })).filter(c => /^UC[a-zA-Z0-9_-]{20,}$/.test(c.id));
      const out = await rpc('glasstube_push', {
        p_code: code,
        p_video: { kind: 'channels', channels: list },
      });
      return json(res, 200, Object.assign({ ok: true }, out, { kind: 'channels', channels: list }));
    }

    if (openChannel && openChannel.id) {
      const ch = {
        kind: 'channel',
        id: String(openChannel.id),
        name: String(openChannel.name || 'Channel').slice(0, 80),
      };
      if (!/^UC[a-zA-Z0-9_-]{20,}$/.test(ch.id)) {
        return json(res, 200, { ok: false, error: 'That channel id looks wrong.' });
      }
      const out = await rpc('glasstube_push', { p_code: code, p_video: ch });
      return json(res, 200, Object.assign({ ok: true }, out, { kind: 'channel', channel: ch }));
    }

    let videos = [];
    let name = String(body.name || '').slice(0, 80);

    if (incoming && incoming.length) {
      for (const item of incoming.slice(0, MAX_PLAYLIST)) {
        if (item && item.id && VIDEO_RE.test(item.id)) {
          videos.push(slim(item));
          continue;
        }
        const got = await resolveOne(item && (item.url || item.id || item));
        if (!got) continue;
        if (got.list) videos.push.apply(videos, got.videos);
        else if (got.video) videos.push(got.video);
      }
    } else {
      const got = await resolveOne(raw);
      if (!got) {
        return json(res, 200, {
          ok: false,
          error: parseYouTube(raw)
            ? 'YouTube blocked that video from other apps.'
            : 'That does not look like a YouTube link.',
        });
      }
      if (got.list) {
        videos = got.videos;
        if (!name) name = got.name;
      } else if (got.video) {
        videos = [got.video];
      }
    }

    videos = videos.filter((v, i, all) => v && v.id && all.findIndex(x => x.id === v.id) === i)
      .slice(0, MAX_PLAYLIST);
    videos = await keepPlayable(videos);
    if (!videos.length) {
      return json(res, 200, { ok: false, error: 'No playable videos in that list.' });
    }

    const payload = pack(videos, name, body.app);
    const first = videos[0] || {};
    console.log('[glasstube-push]', JSON.stringify({
      id: first.id || '',
      hasU: !!first.u,
      n: videos.length,
    }));
    const out = await rpc('glasstube_push', { p_code: code, p_video: payload });
    return json(res, 200, Object.assign({}, out, { video: videos[0], videos, name: payload.playlist }));
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
