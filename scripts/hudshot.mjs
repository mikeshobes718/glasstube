// HUD screenshot harness for GlassTube on Meta Ray-Ban Display.
//
//   npm i --no-save playwright-core && npx playwright-core install chromium   (once)
//   node scripts/hudshot.mjs --out /tmp/shots [--root .] [--steps "<script>"] [--name base] [--additive]
//
// Set GLASSTUBE_CHROMIUM to a Chrome/Chromium binary to override the lookup.
//
// Serves <root> as static files on a local port, proxies /api/* to production
// (so search, feeds and oembed return real data), opens the HUD at 600x600 with
// the glasses' user agent, plays a key script, and saves a PNG after each
// "shot:<label>" step.
//
// Steps are separated by ";". Each step is one of:
//   key:ArrowDown        press a key (ArrowUp/Down/Left/Right, Enter, Escape, Backspace, any char)
//   key:ArrowDown*3      press it 3 times
//   wait:800             wait ms
//   shot:label           screenshot -> <out>/<name>-<label>.png (plus -additive.png with --additive)
//   eval:<js>            run JS in the page (e.g. eval:localStorage.clear())
//   reload               reload the page
//   goto:/path           navigate to a path on the local server
//
// Pairing is stubbed (code TESTQA). --paired fakes a paired phone, --push
// <id,id> fakes a phone push after --push-after ms (default 4000). HUD reports
// posted to /api/watch are printed as [hud-report] instead of reaching prod.
//
// --additive also writes a version blended additively over a mid-bright
// real-world background: the Ray-Ban Display adds light, so black is
// transparent and dim greys nearly vanish. Judge legibility on THAT image.
//
// Offline / fixtures: when production cannot be reached (or with --offline),
// /api/search, /api/feed, /api/oembed, /api/suggest and /api/watch are answered
// from scripts/fixtures instead, and i.ytimg.com thumbnails come from
// scripts/fixtures/thumbs. Fixture data is for layout only, never for claims
// about what production returns.
//
// --media "id=file.mp4,id2=403"   push a phone file for these ids. The HUD gets a
//     googlevideo-shaped URL (so the 'file' route runs) that the harness serves
//     from the local file (resolved against cwd, then $GLASSTUBE_MEDIA, default
//     /tmp/glasstube-media; make them with scripts/mkmedia.sh), or answers 403.
// --push2-after <ms>   re-push the same payload as seq 2 at that time.
// --autoplay-policy <p>   Chromium autoplay policy (default no-user-gesture-required;
//     the glasses WebView is closer to user-gesture-required).
// POST /api/diag, /api/watch (reports) and POST /api/pair bodies other than a
// plain mint are printed as [hud-report] / [pair-post] and never reach prod.
//
// Console errors from the page are printed at the end.
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes('--' + k);
const ROOT = resolve(opt('root', process.cwd()));
const OUT = resolve(opt('out', './shots'));
const NAME = opt('name', 'hud');
const STEPS = opt('steps', 'wait:2500;shot:home');
const ADDITIVE = flag('additive');
// Pairing is stubbed locally so test runs never mint real pairs in production.
// --paired       the HUD sees a paired phone
// --push <ids>   after --push-after ms, the "phone" pushes these comma-separated
//                video ids (titles fetched from /api/oembed via production)
const PAIRED = flag('paired') || !!opt('push', '');
const PUSH_IDS = (opt('push', '') || '').split(',').filter(Boolean);
const PUSH_AFTER = Number(opt('push-after', '4000'));
const PUSH2_AFTER = Number(opt('push2-after', '0'));
const AUTOPLAY = opt('autoplay-policy', 'no-user-gesture-required');
const MEDIA_DIR = process.env.GLASSTUBE_MEDIA || '/tmp/glasstube-media';
const MEDIA = {};
for (const pair of String(opt('media', '') || '').split(',').filter(Boolean)) {
  const [id, file] = pair.split('=');
  if (!id || !file) continue;
  if (file === '403' || /^\d{3}$/.test(file)) { MEDIA[id] = Number(file); continue; }
  const base = file.split('/').pop();
  const cands = [resolve(file), join(MEDIA_DIR, file), join(MEDIA_DIR, base),
    join(MEDIA_DIR, base.replace(/\.mp4$/, '.webm'))];
  MEDIA[id] = cands.find(f => existsSync(f)) || cands[0];
}
const FIX = join(resolve(new URL('.', import.meta.url).pathname), 'fixtures');
function mediaUrl(id) {
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  return 'https://rr1---sn-hudshot.googlevideo.com/videoplayback?expire=' + exp +
    '&ei=hudshot&ip=127.0.0.1&id=o-' + id + '&itag=18&source=youtube&requiressl=yes' +
    '&mime=video%2Fmp4&dur=20.000&lmt=1&sparams=expire%2Cei%2Cip%2Cid%2Citag&sig=hudshot' + id;
}
async function readBuild() {
  try {
    const t = await readFile(join(ROOT, 'api', '_build.js'), 'utf8');
    const m = t.match(/BUILD\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}
const started = Date.now();
let pushDest = null;
async function buildPush() {
  const videos = [];
  for (const id of PUSH_IDS) {
    let title = 'YouTube video', channel = '';
    try {
      const j = OFFLINE ? fixtureOembed(id)
        : await (await fetch(PROD + '/api/oembed?url=' + encodeURIComponent('https://youtu.be/' + id))).json();
      title = j.title || title; channel = j.channel || '';
    } catch (e) {}
    const v = { id, title, channel, thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' };
    if (MEDIA[id] !== undefined) v.u = mediaUrl(id);
    videos.push(v);
  }
  const d = { id: videos[0].id, title: videos[0].title, channel: videos[0].channel, thumb: videos[0].thumb,
    videos, playlist: 'From iPhone', app: '2.2 (35)', ts: Date.now() };
  if (videos[0].u) d.u = videos[0].u;
  return d;
}
const PROD = 'https://glasstube.vercel.app';
const UA = 'Mozilla/5.0 (Linux; Android 14; Greatwhite Build/UKQ1.250303.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.173 Safari/537.36';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

let OFFLINE = flag('offline');
if (!OFFLINE) {
  try {
    const r = await fetch(PROD + '/api/oembed?url=' + encodeURIComponent('https://youtu.be/8WSyoITbP-c'),
      { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    OFFLINE = true;
  }
}
if (OFFLINE) console.log('[hudshot] production unreachable or --offline: serving fixtures for /api/* and thumbnails');
const FIXTURE = JSON.parse(await readFile(join(FIX, 'videos.json'), 'utf8'));
function fixtureOembed(id) {
  const v = FIXTURE.videos.find(x => x.id === id);
  return v ? { title: v.title, channel: v.channel } : { title: 'Fixture video ' + id, channel: 'Fixture channel' };
}
function fixtureVideos(seed, n) {
  const all = FIXTURE.videos;
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const out = [];
  for (let i = 0; i < Math.min(n, all.length); i++) out.push(all[(h + i) % all.length]);
  return out.map(v => Object.assign({}, v, { thumb: 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg',
    meta: [v.duration, v.views, v.when].filter(Boolean).join(' · ') }));
}
function fixtureApi(u) {
  const q = Object.fromEntries(u.searchParams);
  const p = u.pathname;
  if (p === '/api/search' || (p === '/api/feed' && (q.mode === 'search' || q.q))) {
    const term = String(q.q || '').trim();
    if (!term) return { body: { ok: false, error: 'Type something to search.' } };
    return { body: { ok: true, q: term, videos: fixtureVideos(term, Number(q.limit) || 20) } };
  }
  if (p === '/api/suggest' || (p === '/api/feed' && q.mode === 'suggest')) {
    const t = String(q.q || '').toLowerCase();
    const words = ['music', 'live', 'review', 'tutorial', 'podcast', 'highlights'];
    return { body: { ok: true, suggestions: t ? words.map(w => t + ' ' + w) : [] } };
  }
  if (p === '/api/feed') {
    const ch = String(q.channel || q.handle || q.url || '');
    if (!ch) return { body: { ok: false, error: 'channel required' } };
    const name = (FIXTURE.channels[ch] || 'Fixture channel');
    return { body: { ok: true, channel: name, videos: fixtureVideos(ch, 15).map(v => Object.assign(v, { channel: name })) } };
  }
  if (p === '/api/oembed') {
    const m = String(q.url || '').match(/([A-Za-z0-9_-]{11})/);
    return { body: Object.assign({ ok: true }, fixtureOembed(m ? m[1] : '')) };
  }
  if (p === '/api/watch') {
    if (q.probe) return { body: { ok: false, error: 'offline fixture: no server resolve' } };
    return { status: 502, body: { ok: false, error: 'offline fixture: proxy unavailable' } };
  }
  return { status: 404, body: { ok: false, error: 'offline fixture: no handler for ' + p } };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/pair' || u.pathname === '/api/account') {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST') {
        const c = []; for await (const d of req) c.push(d);
        const raw = Buffer.concat(c).toString();
        let b = null; try { b = raw ? JSON.parse(raw) : null; } catch (e) {}
        if (b && Object.keys(b).length) console.log('[pair-post]', raw.slice(0, 300));
        return res.end(JSON.stringify({ ok: true, code: 'TESTQA', token: 'local-test-token', paired: PAIRED }));
      }
      let dest = null, seq = 0;
      if (PUSH_IDS.length && Date.now() - started > PUSH_AFTER) {
        if (!pushDest) pushDest = await buildPush();
        dest = pushDest; seq = 1;
        if (PUSH2_AFTER && Date.now() - started > PUSH2_AFTER) seq = 2;
      }
      const out = { ok: true, code: 'TESTQA', paired: PAIRED, dest, destSeq: seq };
      const build = await readBuild();
      if (build) out.build = build;
      return res.end(JSON.stringify(out));
    }
    if ((u.pathname === '/api/watch' || u.pathname === '/api/diag') && req.method === 'POST') {
      const c = []; for await (const d of req) c.push(d);
      console.log('[hud-report]', Buffer.concat(c).toString().slice(0, 300));
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
    }
    if (u.pathname.startsWith('/api/') && OFFLINE) {
      const fx = fixtureApi(u);
      res.writeHead(fx.status || 200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(fx.body));
    }
    if (u.pathname.startsWith('/api/')) {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await new Promise(r => {
        const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c)));
      });
      const up = await fetch(PROD + u.pathname + u.search, { method: req.method, body,
        headers: { 'content-type': req.headers['content-type'] || 'application/json' }, redirect: 'manual' });
      const buf = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' });
      return res.end(buf);
    }
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (p === '/phone') p = '/phone.html';
    const f = join(ROOT, p);
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(f));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

function findChrome() {
  if (process.env.GLASSTUBE_CHROMIUM) return process.env.GLASSTUBE_CHROMIUM;
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(root, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(p)) return p;
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  // Elsewhere (Linux, CI, cloud) let Playwright use the Chromium it installed.
  return existsSync(mac) ? mac : undefined;
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), headless: true,
  args: ['--autoplay-policy=' + AUTOPLAY] });
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, userAgent: UA, deviceScaleFactor: 1 });
// googlevideo: serve --media files (or the status asked for).
await ctx.route(/^https:\/\/[^/]*googlevideo\.com\//, async route => {
  const m = route.request().url().match(/[?&]id=o-([A-Za-z0-9_-]{11})/);
  const media = m ? MEDIA[m[1]] : undefined;
  if (typeof media === 'number') return route.fulfill({ status: media, body: 'refused' });
  if (!media || !existsSync(media)) return route.fulfill({ status: 404, body: 'no media' });
  const buf = await readFile(media);
  const ctype = media.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  const range = route.request().headers()['range'];
  const mm = range && range.match(/bytes=(\d+)-(\d*)/);
  if (mm) {
    const a = Number(mm[1]), b = mm[2] ? Math.min(Number(mm[2]), buf.length - 1) : buf.length - 1;
    return route.fulfill({ status: 206, body: buf.subarray(a, b + 1), headers: {
      'content-type': ctype, 'accept-ranges': 'bytes',
      'content-range': 'bytes ' + a + '-' + b + '/' + buf.length } });
  }
  return route.fulfill({ status: 200, body: buf, headers: { 'content-type': ctype, 'accept-ranges': 'bytes' } });
});
if (OFFLINE) {
  const thumbs = readdirSync(join(FIX, 'thumbs')).filter(f => f.endsWith('.jpg')).sort();
  await ctx.route(/^https:\/\/i\.ytimg\.com\//, async route => {
    const m = route.request().url().match(/\/vi\/([^/]+)\//);
    let h = 0; for (const ch of (m ? m[1] : 'x')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: await readFile(join(FIX, 'thumbs', thumbs[h % thumbs.length])) });
  });
  // Anything else off-box would hang on the blocked network: fail it fast.
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|[^/]*googlevideo\.com|i\.ytimg\.com)/, route => route.abort('internetdisconnected'));
}
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });

async function additive(pngPath) {
  // Blend in the page itself so no image library is needed.
  const data = (await readFile(pngPath)).toString('base64');
  const p2 = await ctx.newPage();
  await p2.setContent(`<html><body style="margin:0;background:#000">
    <canvas id=c width=600 height=600></canvas>
    <script>
      const c=document.getElementById('c'),x=c.getContext('2d');
      // A mid-bright indoor scene: warm wall, window light, a dark doorway, clutter.
      const g=x.createLinearGradient(0,0,600,600);g.addColorStop(0,'#7a6a58');g.addColorStop(.5,'#5b5146');g.addColorStop(1,'#3a342e');
      x.fillStyle=g;x.fillRect(0,0,600,600);
      x.fillStyle='rgba(235,238,245,.55)';x.fillRect(360,40,200,240);
      x.fillStyle='rgba(20,18,16,.6)';x.fillRect(40,200,140,400);
      for(let i=0;i<60;i++){x.fillStyle='rgba('+(120+((i*37)%120))+','+(100+((i*53)%110))+','+(80+((i*71)%100))+',.35)';x.fillRect((i*97)%600,(i*61)%600,30+(i*13)%60,20+(i*7)%50)}
      const im=new Image();im.onload=()=>{x.globalCompositeOperation='lighter';x.globalAlpha=0.9;x.drawImage(im,0,0);window.done=true};
      im.src='data:image/png;base64,${data}';
    </script></body></html>`);
  await p2.waitForFunction('window.done === true');
  await p2.locator('#c').screenshot({ path: pngPath.replace(/\.png$/, '-additive.png') });
  await p2.close();
}

for (const raw of STEPS.split(';').map(s => s.trim()).filter(Boolean)) {
  const i = raw.indexOf(':');
  const cmd = i < 0 ? raw : raw.slice(0, i);
  const val = i < 0 ? '' : raw.slice(i + 1);
  if (cmd === 'key') {
    const [k, n] = val.split('*');
    for (let j = 0; j < (Number(n) || 1); j++) { await page.keyboard.press(k); await page.waitForTimeout(140); }
  } else if (cmd === 'wait') {
    await page.waitForTimeout(Number(val) || 500);
  } else if (cmd === 'shot') {
    const f = join(OUT, `${NAME}-${val}.png`);
    await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 600, height: 600 } });
    if (ADDITIVE) await additive(f);
    console.log('saved', f);
  } else if (cmd === 'eval') {
    try { console.log('eval ->', JSON.stringify(await page.evaluate(val))); } catch (e) { console.log('eval error', e.message); }
  } else if (cmd === 'reload') {
    await page.reload({ waitUntil: 'domcontentloaded' });
  } else if (cmd === 'goto') {
    await page.goto(base + val, { waitUntil: 'domcontentloaded' });
  }
}
if (errors.length) console.log('PAGE ERRORS:\n' + [...new Set(errors)].join('\n'));
await browser.close();
server.close();
