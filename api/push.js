import { rpc, rpcConfigured, readBody, json } from './_rpc.js';
import { parseYouTube, oembed, keepPlayable, resolveHandle, channelFeed, playlistFeed } from './_yt.js';
import {
  deliveryRead, deliveryVerdict, notCheckedInText, SETTLED, SEEN_STALE_S, SUPERSEDED_TEXT,
} from './_delivery.js';

const VIDEO_RE = /^[a-zA-Z0-9_-]{11}$/;
const MAX_PLAYLIST = 20;

/* WP6: how long a video push waits for the glasses to confirm.

   The plan allows 12s of waiting, but the iPhone app's push request (iOS
   StreamResolver.postPush) runs on a URLSession whose request timeout is 12s
   of silence. A reply slower than that reads on the phone as "No internet.
   Retrying..." - worse than any honest answer. So the whole handler, resolve
   included, stays inside BUDGET_MS from its first line, which leaves room for
   a cold start and the round trip. Raise BUDGET_MS to about 13000 once every
   phone runs a build whose push request allows 30s (iOS change in hud-wp6). */
const WAIT_MS = 12000;
const BUDGET_MS = 9500;
const POLL_MS = 400;

const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function firstNum() {
  for (const v of arguments) {
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/* Wait for the glasses to say what happened to this push. `before` is the
   delivery row read just before the push went in; null means the backend
   cannot say (migration not run, or unreachable), and then the answer is
   today's immediate ok:true. */
async function confirmDelivery(code, out, before, t0) {
  if (!before) {
    return { delivery: { state: 'unknown', glassesSeenS: null, glassesBuild: null } };
  }
  const info = state => ({ state, glassesSeenS: before.seenS, glassesBuild: before.build });
  if (before.seenS === null || before.seenS > SEEN_STALE_S) {
    // The push stays pending; the glasses pick it up when GlassTube opens.
    return { ok: false, error: notCheckedInText(before.seenS), delivery: info('away') };
  }
  if (!before.build) {
    // The glasses run a build from before delivery reports: nothing to wait for.
    return { delivery: info('sent') };
  }
  const deadline = Math.min(Date.now() + WAIT_MS, t0 + BUDGET_MS);
  let seq = firstNum(out && out.destSeq, out && out.dest_seq, out && out.seq);
  let got = false;
  while (Date.now() < deadline) {
    const d = await deliveryRead(code, Math.max(300, Math.min(3000, deadline - Date.now())));
    if (d) {
      if (seq === null) seq = d.destSeq;
      if (seq !== null && d.ackSeq === seq && d.ackState) {
        if (SETTLED[d.ackState]) {
          return Object.assign({}, deliveryVerdict(d.ackState, d.ackDetail), { delivery: info(d.ackState) });
        }
        if (d.ackState === 'got') got = true;
      }
    }
    await sleep(Math.min(POLL_MS, deadline - Date.now()));
  }
  const state = got ? 'got' : 'none';
  return Object.assign({}, deliveryVerdict(state), { delivery: info(state) });
}

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
  const t0 = Date.now();
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

  // WP6: read the delivery row while the videos resolve. It says whether the
  // glasses replaced this link, and whether they have checked in lately.
  const pre = deliveryRead(code, 2500);
  const replaced = async () => {
    const row = await pre;
    if (!(row && row.superseded)) return false;
    json(res, 200, { ok: false, moved: true, error: SUPERSEDED_TEXT });
    return true;
  };

  try {
    if (body.kind === 'session') {
      if (await replaced()) return;
      const blob = String(body.session || '');
      const out = await rpc('glasstube_push', {
        p_code: code,
        p_video: { kind: 'session', session: blob, ts: Date.now() },
      });
      return json(res, 200, Object.assign({ ok: true }, out, { kind: 'session' }));
    }

    if (channels) {
      if (await replaced()) return;
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
      if (await replaced()) return;
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
    if (await replaced()) return;
    const before = await pre;
    const out = await rpc('glasstube_push', { p_code: code, p_video: payload });
    const reply = Object.assign({}, out, { video: videos[0], videos, name: payload.playlist });
    if (!out || out.ok === false) return json(res, 200, reply);
    // WP6: 'Playing on your glasses' only once the glasses say so.
    const verdict = await confirmDelivery(code, out, before, t0);
    console.log('[glasstube-delivery]', JSON.stringify({
      id: first.id || '', state: verdict.delivery.state, ms: Date.now() - t0,
      seenS: verdict.delivery.glassesSeenS, build: verdict.delivery.glassesBuild,
    }));
    Object.assign(reply, verdict);
    if (verdict.ok === true) delete reply.error;
    return json(res, 200, reply);
  } catch (e) {
    return json(res, 200, { ok: false, error: String((e && e.message) || e) });
  }
}
