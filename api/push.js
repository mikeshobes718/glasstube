import { rpc, rpcConfigured, readBody, json } from './_rpc.js';
import { parseYouTube, oembed, resolveHandle, channelFeed, playlistFeed } from './_yt.js';

const VIDEO_RE = /^[a-zA-Z0-9_-]{11}$/;
const MAX_PLAYLIST = 20;

function slim(video) {
  return {
    id: video.id,
    title: String(video.title || 'YouTube video').slice(0, 120),
    channel: String(video.channel || '').slice(0, 80),
    thumb: video.thumb || ('https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'),
  };
}

async function resolveOne(raw) {
  const parsed = parseYouTube(raw);
  if (!parsed) return null;

  if (parsed.kind === 'playlist') {
    const feed = await playlistFeed(parsed.id, MAX_PLAYLIST);
    return {
      list: true,
      name: feed.title || 'Playlist',
      videos: (feed.videos || []).map(slim),
    };
  }

  if (parsed.kind === 'video') {
    const video = (await oembed(parsed.id)) || {
      id: parsed.id,
      title: 'YouTube video',
      channel: '',
      thumb: 'https://i.ytimg.com/vi/' + parsed.id + '/hqdefault.jpg',
    };
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

function pack(videos, name) {
  const first = videos[0];
  return Object.assign({}, first, {
    playlist: name || (videos.length > 1 ? 'Playlist' : ''),
    videos,
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
  if (!channels && !(openChannel && openChannel.id) && !raw && !(incoming && incoming.length)) {
    return json(res, 200, { ok: false, error: 'Paste a YouTube link or send a playlist' });
  }

  try {
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
        return json(res, 200, { ok: false, error: 'That does not look like a YouTube link.' });
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
    if (!videos.length) {
      return json(res, 200, { ok: false, error: 'No playable videos in that list.' });
    }

    const payload = pack(videos, name);
    const out = await rpc('glasstube_push', { p_code: code, p_video: payload });
    return json(res, 200, Object.assign({}, out, { video: videos[0], videos, name: payload.playlist }));
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
