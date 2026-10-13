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
const started = Date.now();
let pushDest = null;
async function buildPush() {
  const videos = [];
  for (const id of PUSH_IDS) {
    let title = 'YouTube video', channel = '';
    try {
      const j = await (await fetch(PROD + '/api/oembed?url=' + encodeURIComponent('https://youtu.be/' + id))).json();
      title = j.title || title; channel = j.channel || '';
    } catch (e) {}
    videos.push({ id, title, channel, thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' });
  }
  return { id: videos[0].id, title: videos[0].title, channel: videos[0].channel, thumb: videos[0].thumb,
    videos, playlist: 'From iPhone', app: '2.2 (35)', ts: Date.now() };
}
const PROD = 'https://glasstube.vercel.app';
const UA = 'Mozilla/5.0 (Linux; Android 14; Greatwhite Build/UKQ1.250303.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/151.0.7922.173 Safari/537.36';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/pair' || u.pathname === '/api/account') {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST') return res.end(JSON.stringify({ ok: true, code: 'TESTQA', token: 'local-test-token', paired: PAIRED }));
      let dest = null, seq = 0;
      if (PUSH_IDS.length && Date.now() - started > PUSH_AFTER) {
        if (!pushDest) pushDest = await buildPush();
        dest = pushDest; seq = 1;
      }
      return res.end(JSON.stringify({ ok: true, code: 'TESTQA', paired: PAIRED, dest, destSeq: seq }));
    }
    if (u.pathname === '/api/watch' && req.method === 'POST') {
      const c = []; for await (const d of req) c.push(d);
      console.log('[hud-report]', Buffer.concat(c).toString().slice(0, 300));
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
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
  args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, userAgent: UA, deviceScaleFactor: 1 });
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
