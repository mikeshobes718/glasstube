import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readBody, json } from './_rpc.js';
import { loadSession, withSession } from './auth/_google.js';

const VIDEO_RE = /^[a-zA-Z0-9_-]{11}$/;
const CHUNK = 2 * 1024 * 1024;
const cache = new Map();

const ANDROID = {
  key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    hl: 'en',
    gl: 'US',
  },
  name: '3',
};

const ANDROID_SDKLESS = {
  key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    hl: 'en',
    gl: 'US',
  },
  name: '3',
};

const ANDROID_VR = {
  key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
  ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  client: {
    clientName: 'ANDROID_VR',
    clientVersion: '1.62.27',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    androidSdkVersion: 32,
    osName: 'Android',
    osVersion: '12L',
    hl: 'en',
    gl: 'US',
  },
  name: '28',
};

const IOS = {
  key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
  ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_5_0 like Mac OS X)',
  client: {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '18.5.0',
    hl: 'en',
    gl: 'US',
  },
  name: '5',
};

const WEB = {
  key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  client: {
    clientName: 'WEB',
    clientVersion: '2.20250312.04.00',
    hl: 'en',
    gl: 'US',
  },
  name: '1',
};

function itagOf(url) {
  const m = String(url || '').match(/[?&]itag=(\d+)/);
  return m ? m[1] : '';
}

function itagOk(url) {
  const n = itagOf(url);
  return n === '18' || n === '22';
}

function formatURL(f) {
  if (!f) return '';
  if (f.url) return String(f.url);
  const raw = f.signatureCipher || f.cipher;
  if (!raw) return '';
  try {
    const q = new URLSearchParams(String(raw));
    if (q.get('s')) return '';
    return q.get('url') || '';
  } catch (e) {
    return '';
  }
}

function pickFormat(streamingData) {
  const list = [].concat(
    (streamingData && streamingData.formats) || [],
    (streamingData && streamingData.adaptiveFormats) || []
  ).map(f => {
    const url = formatURL(f);
    return f && url && /audio|video/.test(String(f.mimeType || '')) ? Object.assign({}, f, { url: url }) : null;
  }).filter(Boolean);
  const byItag = n => list.find(f => Number(f.itag) === n);
  const progressive = list.filter(f =>
    /video\/mp4/i.test(f.mimeType || '') &&
    /mp4a/i.test(f.mimeType || '') &&
    Number(f.height || 0) <= 720
  );
  progressive.sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
  return byItag(18) || byItag(22) || progressive[0] || list[0] || null;
}

function noteLine(got) {
  const url = got.media && got.media.url;
  const itag = itagOf(url);
  return [
    got.spec,
    got.play || '-',
    got.http,
    got.formats,
    itag || '-',
    url ? (itagOk(url) ? 'pass' : 'fail') : 'none',
  ].join(':');
}

let visitorCache = null;

async function visitorId() {
  if (visitorCache && visitorCache.exp > Date.now()) return visitorCache.id;
  try {
    const r = await fetch('https://www.youtube.com/', {
      headers: {
        'user-agent': WEB.ua,
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    const html = await r.text();
    const m = html.match(/"VISITOR_DATA":"([^"]+)"/) || html.match(/"visitorData":"([^"]+)"/);
    const id = m ? m[1] : '';
    if (id) visitorCache = { id: id, exp: Date.now() + 30 * 60 * 1000 };
    return id;
  } catch (e) {
    return '';
  }
}

async function player(id, spec, auth, extra) {
  const visitor = (extra && extra.visitorData) || '';
  const client = Object.assign({}, spec.client);
  if (visitor) client.visitorData = visitor;
  const headers = {
    'content-type': 'application/json',
    'user-agent': spec.ua,
    'x-youtube-client-name': spec.name,
    'x-youtube-client-version': spec.client.clientVersion,
    origin: 'https://www.youtube.com',
    referer: 'https://www.youtube.com/watch?v=' + id,
  };
  if (auth) {
    headers.authorization = 'Bearer ' + auth;
    headers['x-goog-authuser'] = '0';
  }
  if (visitor) headers['x-goog-visitor-id'] = visitor;
  const r = await fetch(
    'https://www.youtube.com/youtubei/v1/player?key=' + spec.key + '&prettyPrint=false',
    {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        videoId: id,
        contentCheckOk: true,
        racyCheckOk: true,
        context: {
          client: client,
          user: { lockedSafetyMode: false },
        },
      }),
    }
  );
  let j = {};
  try { j = await r.json(); } catch (e) { j = {}; }
  const st = (j && j.playabilityStatus) || {};
  const ytErr = (j && j.error) || {};
  const fmt = pickFormat(j.streamingData);
  const stream = j.streamingData || {};
  const play = st.status || String(ytErr.status || '') || (ytErr.code ? ('ERR' + ytErr.code) : '');
  return {
    spec: spec.client.clientName,
    http: r.status,
    play: play,
    reason: String(st.reason || ytErr.message || '').slice(0, 80),
    formats: ((stream.formats || []).length + (stream.adaptiveFormats || []).length),
    ok: !!(fmt && fmt.url),
    media: fmt && fmt.url ? {
      url: fmt.url,
      mime: String(fmt.mimeType || 'video/mp4').split(';')[0],
      length: Number(fmt.contentLength || 0) || 0,
      ua: spec.ua,
      exp: Date.now() + 4 * 60 * 1000,
    } : null,
  };
}

function keepMedia(id, got, notes) {
  if (!got || !got.ok || !got.media || !itagOk(got.media.url)) return null;
  cache.set(id, got.media);
  got.media.notes = notes;
  got.media.play = got.play;
  got.media.formats = got.formats;
  return got.media;
}

/* YouTube answers datacenter IPs with LOGIN_REQUIRED far more often than it
   used to, so try every guest shape before falling back to the signed-in WEB
   client. A visitorData lifted from a real page load is what separates a
   "browser that has been here" from a bare bot on some of these. */
async function resolve(id, auth) {
  const hit = cache.get(id);
  if (hit && hit.exp > Date.now()) return hit;
  const notes = [];
  const visitor = await visitorId();
  const guests = [ANDROID_SDKLESS, ANDROID, ANDROID_VR, IOS];
  for (let i = 0; i < guests.length; i++) {
    for (let pass = 0; pass < 2; pass++) {
      const extra = pass === 1 && visitor ? { visitorData: visitor } : {};
      if (pass === 1 && !visitor) continue;
      const got = await player(id, guests[i], null, extra);
      notes.push(noteLine(got) + (pass === 1 ? ':vd' : ''));
      const media = keepMedia(id, got, notes);
      if (media) return media;
    }
  }
  if (auth) {
    const got = await player(id, WEB, auth, { visitorData: visitor });
    notes.push(noteLine(got) + ':auth');
    const media = keepMedia(id, got, notes);
    if (media) return media;
  }
  const err = new Error(notes.join(' | '));
  err.notes = notes;
  throw err;
}

/* The glasses hand back whatever session the phone gave them so a signed-in
   resolve is possible even though the HUD never saw a Google login itself. */
async function sessionFor(req) {
  try {
    const auth = await loadSession(req);
    return (auth && auth.sess && auth.sess.at) || null;
  } catch (e) {
    return null;
  }
}

function parseRange(header, total) {
  const max = total > 0 ? total - 1 : CHUNK - 1;
  const m = String(header || '').match(/bytes=(\d+)-(\d+)?/);
  let start = 0;
  let end = Math.min(max, start + CHUNK - 1);
  if (m) {
    start = Number(m[1]) || 0;
    end = m[2] != null && m[2] !== '' ? Number(m[2]) : start + CHUNK - 1;
  }
  if (total > 0) {
    start = Math.min(start, total - 1);
    end = Math.min(end, total - 1);
  }
  if (end - start + 1 > CHUNK) end = start + CHUNK - 1;
  return { start, end };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const body = (await readBody(req)) || {};
    console.log('[glasstube-diag]', JSON.stringify(body).slice(0, 2000));
    return json(res, 200, { ok: true });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { ok: false, error: 'GET only' });
  }
  const id = String((req.query && req.query.v) || '');
  if (!VIDEO_RE.test(id)) {
    res.statusCode = 400;
    return res.end('bad video id');
  }
  if (String((req.query && req.query.resolve) || '') === '1') {
    let auth = null;
    try {
      auth = await loadSession(req);
    } catch (e) {
      auth = null;
    }
    if (!auth || !auth.sess) {
      console.log('[glasstube-resolve]', JSON.stringify({ id, hasSess: false, ok: false }));
      return json(res, 200, { ok: false, error: 'Sign in with Google first.' });
    }
    try {
      const media = await resolve(id, auth.sess.at);
      const itag = itagOf(media.url);
      const pass = itagOk(media.url);
      console.log('[glasstube-resolve]', JSON.stringify({
        id,
        hasSess: true,
        ok: true,
        play: media.play || '',
        formats: media.formats || 0,
        itag: itag,
        itagOk: pass,
        len: String(media.url || '').length,
        notes: media.notes || [],
      }));
      return withSession(res, {
        ok: true,
        url: media.url,
        mime: media.mime,
        length: media.length,
        ua: media.ua,
        itag: itag,
        itagOk: pass,
        notes: media.notes || [],
      }, auth.token, auth.rotated);
    } catch (e) {
      console.log('[glasstube-resolve]', JSON.stringify({
        id,
        hasSess: true,
        ok: false,
        notes: (e && e.notes) || [],
        error: String((e && e.message) || e || 'resolve failed'),
      }));
      return withSession(res, { ok: false, error: String((e && e.message) || e || 'resolve failed'), notes: (e && e.notes) || [] }, auth.token, auth.rotated);
    }
  }
  if (String((req.query && req.query.probe) || '') === '1') {
    const auth = await sessionFor(req);
    try {
      const media = await resolve(id, auth);
      return json(res, 200, {
        ok: true,
        itag: itagOf(media.url),
        mime: media.mime,
        length: media.length || 0,
        signedIn: !!auth,
        notes: media.notes || [],
      });
    } catch (e) {
      return json(res, 200, {
        ok: false,
        signedIn: !!auth,
        error: String((e && e.message) || e || 'resolve failed'),
        notes: (e && e.notes) || [],
      });
    }
  }
  if (String((req.query && req.query.go) || '') === '1') {
    const origin = 'https://glasstube.vercel.app';
    const params = new URLSearchParams({
      enablejsapi: '1',
      origin: origin,
      widget_referrer: origin + '/',
      autoplay: req.query.autoplay === '1' ? '1' : '0',
      mute: '1',
      controls: '0',
      disablekb: '1',
      fs: '0',
      rel: '0',
      playsinline: '1',
      iv_load_policy: '3',
    });
    const start = Math.max(0, Math.floor(Number((req.query && req.query.start) || 0) || 0));
    if (start > 0) params.set('start', String(start));
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'origin');
    res.setHeader('Location', 'https://www.youtube.com/embed/' + encodeURIComponent(id) + '?' + params.toString());
    return res.end();
  }
  let media;
  try {
    media = await resolve(id, await sessionFor(req));
  } catch (e) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('no playable stream ' + String((e && e.notes && e.notes.join(',')) || e.message || e));
  }
  if (!media) {
    res.statusCode = 404;
    return res.end('no playable stream');
  }
  const total = media.length;
  const { start, end } = parseRange(req.headers.range, total);
  const rangeHdr = 'bytes=' + start + '-' + end;
  if (req.method === 'HEAD') {
    res.statusCode = total ? 206 : 200;
    res.setHeader('Content-Type', media.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (total) {
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
      res.setHeader('Content-Length', String(end - start + 1));
    }
    return res.end();
  }
  try {
    const up = await fetch(media.url, {
      headers: {
        'user-agent': media.ua,
        range: rangeHdr,
      },
    });
    if (!up.ok && up.status !== 206) {
      cache.delete(id);
      res.statusCode = 502;
      return res.end('media fetch failed');
    }
    res.statusCode = up.status === 206 || total ? 206 : 200;
    res.setHeader('Content-Type', up.headers.get('content-type') || media.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    const cr = up.headers.get('content-range');
    const cl = up.headers.get('content-length');
    if (cr) res.setHeader('Content-Range', cr);
    else if (total) res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
    if (cl) res.setHeader('Content-Length', cl);
    if (!up.body) return res.end();
    await pipeline(Readable.fromWeb(up.body), res);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end('pipe failed');
    }
  }
}
