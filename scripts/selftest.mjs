#!/usr/bin/env node
/* GlassTube end-to-end self test.
 *
 *   node scripts/selftest.mjs                 # against production
 *   node scripts/selftest.mjs --base http://localhost:3000
 *   node scripts/selftest.mjs --no-browser    # API checks only, no Chromium
 *
 * Run this before and after touching the play path. It is the thing that would
 * have caught the outage in September 2026, where the HUD was shipped expecting
 * a payload the installed phone build had no code to send and nothing failed
 * loudly enough to notice.
 *
 * It checks the four things that have actually broken in the wild:
 *
 *   1. Can this machine still resolve a stream the way the phone does?
 *      (YouTube changes its InnerTube clients without warning.)
 *   2. Does a pair survive a restart, i.e. does the link token work?
 *   3. Does push -> poll carry the file URL through untouched?
 *   4. Does the HUD actually play - on the phone-file route, and on the
 *      fallback chain when no file is offered?
 *
 * Chromium comes from a Playwright cache if one is present; without it the
 * browser checks are skipped and the API checks still run.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = String(opt('base', 'https://glasstube.vercel.app')).replace(/\/$/, '');
const SAMPLE = opt('video', '9bZkp7q19f0');

let failures = 0;
let skipped = 0;

function ok(name, detail) {
  console.log('  \x1b[32mPASS\x1b[0m ' + name + (detail ? '  ' + detail : ''));
}
function bad(name, detail) {
  failures += 1;
  console.log('  \x1b[31mFAIL\x1b[0m ' + name + (detail ? '  ' + detail : ''));
}
function skip(name, why) {
  skipped += 1;
  console.log('  \x1b[33mSKIP\x1b[0m ' + name + (why ? '  ' + why : ''));
}
function group(title) {
  console.log('\n' + title);
}

async function getJSON(path, init) {
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('non-JSON from ' + path + ': ' + text.slice(0, 120)); }
}

/* ---- 1. stream resolve, the way the phone does it ---------------------- */

const ANDROID = {
  ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
  name: '3',
  client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en', gl: 'US' },
};

async function resolveLikePhone(id) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': ANDROID.ua,
      'x-youtube-client-name': ANDROID.name,
      'x-youtube-client-version': ANDROID.client.clientVersion,
      // YouTube 403s any Origin that is not its own. This is also why the HUD
      // can never make this call itself from a browser.
      origin: 'https://www.youtube.com',
      referer: 'https://www.youtube.com/',
    },
    body: JSON.stringify({
      videoId: id, contentCheckOk: true, racyCheckOk: true,
      context: { client: ANDROID.client },
    }),
  });
  const j = await r.json();
  const all = [
    ...(j.streamingData?.formats || []),
    ...(j.streamingData?.adaptiveFormats || []),
  ];
  const f = all.find(x => x.itag === 18 && x.url) || all.find(x => x.itag === 22 && x.url);
  return { status: j.playabilityStatus?.status, url: f?.url || '' };
}

/* ---- the checks -------------------------------------------------------- */

async function checkApis() {
  group('Server');

  try {
    const d = await getJSON('/api/search?q=veritasium&limit=3');
    if (d.ok && (d.videos || []).length >= 3 && d.videos[0].id && d.videos[0].duration) {
      ok('search answers with durations', d.videos.length + ' hits');
    } else {
      bad('search', JSON.stringify(d).slice(0, 160));
    }
  } catch (e) { bad('search', e.message); }

  try {
    const d = await getJSON('/api/oembed?v=' + SAMPLE);
    if (d.ok && d.title) ok('oembed', d.title.slice(0, 40));
    else bad('oembed', JSON.stringify(d).slice(0, 120));
  } catch (e) { bad('oembed', e.message); }

  // Both routes, separately. The Atom feed rate-limits in bursts, so the page
  // scrape is not a theoretical backup - it is load bearing, and a silent
  // break in it would only show up on a day the feed was already down.
  try {
    const d = await getJSON('/api/feed?channel=UCX6OQ3DkcsbYNE6H8uQQuVA');
    if (d.ok && (d.videos || []).length) ok('channel feed', d.videos.length + ' videos');
    else bad('channel feed', JSON.stringify(d).slice(0, 120));
  } catch (e) { bad('channel feed', e.message); }

  try {
    const d = await getJSON('/api/feed?channel=UCX6OQ3DkcsbYNE6H8uQQuVA&via=page');
    if (d.ok && (d.videos || []).length && d.videos[0].duration) {
      ok('channel feed fallback (page scrape)', d.videos.length + ' videos with durations');
    } else {
      bad('channel feed fallback (page scrape)', JSON.stringify(d).slice(0, 140));
    }
  } catch (e) { bad('channel feed fallback (page scrape)', e.message); }

  // Informational only. YouTube blocks datacenter IPs most days, and the HUD is
  // built to survive that - so a failure here is a note, not a regression.
  try {
    const d = await getJSON('/api/watch?probe=1&v=' + SAMPLE);
    if (d.ok) ok('server-side resolve (bonus route)', 'itag ' + d.itag);
    else skip('server-side resolve (bonus route)', 'blocked today, HUD falls through');
  } catch (e) { skip('server-side resolve (bonus route)', e.message); }
}

async function checkPairing() {
  group('Pairing');

  let code = '';
  let token = '';
  try {
    const d = await getJSON('/api/pair', { method: 'POST' });
    code = d.code || '';
    token = d.token || '';
    if (d.ok && code.length === 6 && token.length >= 32) {
      ok('mint gives a code and a durable token', code);
    } else {
      bad('mint', JSON.stringify(d).slice(0, 160));
      return null;
    }
  } catch (e) { bad('mint', e.message); return null; }

  try {
    const d = await getJSON('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, touch: true }),
    });
    if (d.ok && d.token === token) ok('phone claims the pair and gets the same token');
    else bad('claim', JSON.stringify(d).slice(0, 160));
  } catch (e) { bad('claim', e.message); }

  // The whole point of the token: the phone reopens, the code may be long gone,
  // and the pair still answers.
  try {
    const d = await getJSON('/api/pair?code=' + encodeURIComponent(token));
    if (d.ok && d.paired && d.code === code) ok('poll by token works without the code');
    else bad('poll by token', JSON.stringify(d).slice(0, 160));
  } catch (e) { bad('poll by token', e.message); }

  return { code, token };
}

async function checkPushRoundTrip(pair, fileUrl) {
  group('Push round trip');
  if (!pair) { skip('push', 'no pair'); return; }

  const relay = 'http://192.168.1.44:8787/s/' + SAMPLE;
  try {
    const d = await getJSON('/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pair.token,
        app: '2.1 (29)',
        videos: [{ id: SAMPLE, title: 'selftest', channel: 'selftest', u: fileUrl, r: relay }],
      }),
    });
    if (!d.ok && d.error) { bad('push', d.error); return; }
    ok('push accepted');
  } catch (e) { bad('push', e.message); return; }

  try {
    const d = await getJSON('/api/pair?code=' + encodeURIComponent(pair.token));
    const v = (d.dest && d.dest.videos && d.dest.videos[0]) || {};
    if (!fileUrl) skip('file URL survives the round trip', 'nothing resolved to send');
    else if (v.u === fileUrl) ok('file URL survives the round trip', v.u.length + ' chars');
    else bad('file URL survives the round trip', 'got ' + String(v.u).slice(0, 60));
    if (v.r === relay) ok('relay URL kept separate from the file URL');
    else bad('relay URL kept separate', 'got ' + String(v.r));
    if (d.dest && d.dest.app === '2.1 (29)') ok('phone build reaches the HUD', d.dest.app);
    else bad('phone build reaches the HUD', String(d.dest && d.dest.app));
  } catch (e) { bad('poll after push', e.message); }
}

function findChromium() {
  const explicit = opt('chromium', process.env.GLASSTUBE_CHROMIUM);
  if (explicit && existsSync(explicit)) return explicit;
  const root = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(root)) return '';
  const names = ['chrome-headless-shell', 'headless_shell', 'Chromium'];
  for (const dir of readdirSync(root).sort().reverse()) {
    for (const sub of ['chrome-headless-shell-mac-arm64', 'chrome-mac']) {
      for (const name of names) {
        const p = join(root, dir, sub, name);
        if (existsSync(p)) return p;
      }
    }
  }
  return '';
}

async function checkPlayback(fileUrl) {
  group('HUD playback');
  if (flag('no-browser')) { skip('browser checks', '--no-browser'); return; }

  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch (e) { skip('browser checks', 'playwright-core not installed'); return; }
  const exe = findChromium();
  if (!exe) { skip('browser checks', 'no Chromium found; pass --chromium <path>'); return; }

  const b = await chromium.launch({
    executablePath: exe,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    await runPlayback(b, fileUrl);
  } finally {
    await b.close();
  }
}

async function openHud(browser) {
  const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  return { page, errs };
}

async function settle(page, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1200);
    last = await page.evaluate(() => {
      const s = Player.snapshot();
      return { route: s.route, state: s.state, t: s.time, err: s.error };
    });
    if (last.state === 1 && last.t > 1.5) return last;
  }
  return last;
}

async function runPlayback(browser, fileUrl) {
  {
    const { page, errs } = await openHud(browser);
    if (errs.length) bad('HUD loads clean', errs[0].slice(0, 120));
    else ok('HUD loads with no JS errors');

    const wired = await page.evaluate(() => ({
      menus: [...document.querySelectorAll('#screen-home [data-menu]')].map(e => e.dataset.menu),
      player: typeof Player !== 'undefined',
      routes: typeof Player !== 'undefined' ? Player.routes() : [],
    }));
    if (wired.player && wired.routes.join(',') === 'file,proxy,embed,go') {
      ok('route chain is file,proxy,embed,go');
    } else {
      bad('route chain', JSON.stringify(wired.routes));
    }
    if (wired.menus.includes('search') && wired.menus.includes('debug')) ok('home menu wired');
    else bad('home menu', wired.menus.join(','));

    // Back has to be reachable with nothing but the D-pad, or the search grid
    // traps the wearer: the glasses keep their own back gesture.
    await page.evaluate(() => document.querySelector('[data-menu="search"]').click());
    await page.waitForTimeout(250);
    for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(50); }
    const onKey = await page.$eval('.kb-key.kb-on', e => e.textContent);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const screen = await page.evaluate(() =>
      [...document.querySelectorAll('.screen')].filter(s => !s.classList.contains('hidden')).map(s => s.id));
    if (onKey === 'Back' && screen.includes('screen-home')) ok('search grid can be left with the D-pad');
    else bad('search grid escape', onKey + ' -> ' + screen.join(','));
    await page.close();
  }

  if (fileUrl) {
    const { page } = await openHud(browser);
    await page.evaluate((u) => {
      applyPush({ id: 'selftest', app: '2.1 (29)', videos: [{ id: 'SELFTESTID0', title: 'selftest', u }] });
    }, fileUrl);
    const s = await settle(page, 20);
    if (s && s.state === 1 && s.route === 'file') ok('plays the phone file route', s.t.toFixed(1) + 's in');
    else bad('phone file route', JSON.stringify(s));
    await page.close();
  } else {
    skip('phone file route', 'nothing resolved to play');
  }

  {
    const { page } = await openHud(browser);
    await page.evaluate((id) => {
      applyPush({ id, videos: [{ id, title: 'selftest fallback' }] });
    }, SAMPLE);
    const s = await settle(page, 35);
    if (s && s.state === 1) ok('falls through to a working route with no file', s.route);
    else bad('fallback chain', JSON.stringify(s));
    await page.close();
  }
}

/* ---- run --------------------------------------------------------------- */

console.log('GlassTube self test  ->  ' + BASE);

group('Stream resolve (as the phone does it)');
let fileUrl = '';
try {
  const got = await resolveLikePhone(SAMPLE);
  if (got.url) {
    fileUrl = got.url;
    ok('this network can resolve a progressive file', 'itag 18/22, ' + got.url.length + ' chars');
  } else {
    bad('resolve', 'playabilityStatus=' + got.status +
      ' - if this fails on the phone too, the file route is dead and only embeds remain');
  }
} catch (e) { bad('resolve', e.message); }

await checkApis();
const pair = await checkPairing();
await checkPushRoundTrip(pair, fileUrl);
await checkPlayback(fileUrl);

console.log('\n' + (failures ? '\x1b[31m' + failures + ' failed' : '\x1b[32mall checks passed') +
  '\x1b[0m' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(failures ? 1 : 0);
