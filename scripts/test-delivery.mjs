#!/usr/bin/env node
/* WP6: server-confirmed delivery, tested in-process.

   Imports api/pair.js and api/push.js with a fake pairing backend behind a
   mocked global fetch, then drives the plan's probe scenarios (a)-(h) plus a
   few extra states, twice:

     legacy    the WP6 migration has NOT run: the new RPCs answer like a
               missing function (PostgREST PGRST202 / 404). Everything must
               behave exactly like today, and the missing function must be
               remembered so each request does not pay for a failing call.
     migrated  scripts/sql/2026-10-delivery.sql has run: glasstube_hud_poll,
               glasstube_ack_state, glasstube_delivery and glasstube_supersede
               exist and behave as that file describes.

   The fake backend is an emulation written from the server code, not the live
   database; it proves the server logic, not the SQL. Run:
     node scripts/test-delivery.mjs            (both modes, ~1 min)
     node scripts/test-delivery.mjs legacy     (one mode)
*/

process.env.GLASSTUBE_SUPABASE_URL = 'https://fake-backend.example.supabase.co';
process.env.GLASSTUBE_SUPABASE_KEY = 'test-key';

const GLASSES_UA = 'Mozilla/5.0 (Linux; Android 12; Greatwhite) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const NEW_FNS = ['glasstube_hud_poll', 'glasstube_ack_state', 'glasstube_delivery', 'glasstube_supersede'];

/* ---------------- fake backend ---------------- */

const backend = {
  migrated: false,
  flavour: 'supabase', // how a missing function fails: 'supabase' (PGRST202) or 'berth' (bare 404)
  rows: [],
  calls: {},
  reset(migrated, flavour) {
    this.migrated = migrated;
    this.flavour = flavour || 'supabase';
    this.rows = [];
    this.calls = {};
  },
};

const hex = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const findRow = key => backend.rows.find(r => r.token === key || r.code === String(key || '').toUpperCase());

function pollOut(r) {
  const out = { ok: true, paired: r.paired, code: r.code, token: r.token, destSeq: r.dest_seq };
  if (r.dest && r.dest_seq > r.acked_seq) out.dest = r.dest;
  return out;
}

const fns = {
  glasstube_new_pair() {
    const r = {
      code: Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''),
      token: hex(64), paired: false, dest: null, dest_seq: 0, acked_seq: 0,
      hud_seen_at: null, hud_build: null, hud_who: null,
      ack_seq: null, ack_state: null, ack_detail: null, ack_at: null, superseded_by: null,
    };
    backend.rows.push(r);
    return { ok: true, code: r.code, token: r.token };
  },
  glasstube_touch({ p_code }) {
    const r = findRow(p_code);
    if (!r) return { ok: false, error: 'Code not found' };
    r.paired = true;
    return { ok: true, code: r.code, token: r.token, paired: true };
  },
  glasstube_poll({ p_code }) {
    const r = findRow(p_code);
    if (!r) return { ok: false, error: 'Code not found' };
    return pollOut(r);
  },
  glasstube_ack({ p_code, p_seq }) {
    const r = findRow(p_code);
    if (!r) return { ok: false, error: 'Code not found' };
    if (Number(p_seq) === r.dest_seq) r.acked_seq = r.dest_seq;
    return { ok: true };
  },
  glasstube_push({ p_code, p_video }) {
    const r = findRow(p_code);
    if (!r) return { ok: false, error: 'Code not found' };
    r.dest_seq += 1;
    r.dest = p_video;
    return { ok: true }; // no seq on purpose: the server must read it back
  },
  // ---- WP6 (only when migrated) ----
  glasstube_hud_poll({ p_code, p_build, p_who }) {
    const v = fns.glasstube_poll({ p_code });
    if (v.ok) {
      const r = findRow(p_code);
      r.hud_seen_at = Date.now();
      r.hud_build = p_build || null;
      r.hud_who = p_who || 'hud';
    }
    return v;
  },
  glasstube_ack_state({ p_code, p_seq, p_state, p_detail }) {
    const st = String(p_state || 'got').toLowerCase();
    if (['got', 'hidden', 'missed', 'pinch', 'playing', 'failed'].indexOf(st) < 0) {
      return { ok: false, error: 'Unknown delivery state.' };
    }
    if (st === 'got' || st === 'missed') fns.glasstube_ack({ p_code, p_seq });
    const r = findRow(p_code);
    if (r && !(st === 'got' && r.ack_seq === p_seq && r.ack_state && r.ack_state !== 'got')) {
      Object.assign(r, { ack_seq: p_seq, ack_state: st, ack_detail: p_detail, ack_at: Date.now() });
    }
    return { ok: true };
  },
  glasstube_delivery({ p_code }) {
    const r = findRow(p_code);
    if (!r) return { ok: false, missing: true };
    return {
      ok: true,
      hud_seen_s: r.hud_seen_at === null ? null : Math.floor((Date.now() - r.hud_seen_at) / 1000),
      hud_build: r.hud_build, hud_who: r.hud_who,
      ack_seq: r.ack_seq, ack_state: r.ack_state, ack_detail: r.ack_detail,
      dest_seq: r.dest_seq, superseded: r.superseded_by !== null,
    };
  },
  glasstube_supersede({ p_old, p_new_code }) {
    if (!/^[a-f0-9]{64}$/i.test(p_old || '')) return { ok: false, error: 'bad arguments' };
    let n = 0;
    for (const r of backend.rows) {
      if (r.token === p_old && r.superseded_by === null && r.code !== p_new_code) {
        r.superseded_by = p_new_code;
        n += 1;
      }
    }
    return { ok: true, superseded: n };
  },
};

function reply(status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://www.youtube.com/oembed')) {
    const id = decodeURIComponent(u).match(/v=([a-zA-Z0-9_-]{11})/);
    return reply(200, { title: 'Test video ' + (id ? id[1] : ''), author_name: 'Test channel' });
  }
  const m = u.match(/\/rest\/v1\/rpc\/([a-z_]+)$/);
  if (!m) return reply(404, { message: 'unexpected fetch ' + u });
  const name = m[1];
  backend.calls[name] = (backend.calls[name] || 0) + 1;
  await new Promise(r => setTimeout(r, 15)); // a little network latency
  if (NEW_FNS.indexOf(name) >= 0 && !backend.migrated) {
    return backend.flavour === 'berth'
      ? reply(404)
      : reply(404, {
        code: 'PGRST202',
        message: 'Could not find the function public.' + name + ' in the schema cache',
        hint: null,
      });
  }
  const fn = fns[name];
  if (!fn) return reply(404, { code: 'PGRST202', message: 'Could not find the function public.' + name });
  return reply(200, fn(JSON.parse((opts && opts.body) || '{}')));
};

/* ---------------- in-process HTTP ---------------- */

const pairApi = (await import('../api/pair.js')).default;
const pushApi = (await import('../api/push.js')).default;
const { deliveryReset, deliveryStatus } = await import('../api/_delivery.js');

function call(handler, method, { query, body, ua } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve(b); return this; },
    };
    const req = { method, query: query || {}, headers: { 'user-agent': ua || '' }, body: body || {} };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const mint = body => call(pairApi, 'POST', { body: body || {} });
const push = (code, extra) => call(pushApi, 'POST', {
  body: Object.assign({ code, url: 'https://youtu.be/8WSyoITbP-c' }, extra || {}),
  ua: IPHONE_UA,
});
async function timed(p) {
  const t = Date.now();
  const out = await p;
  return [out, Date.now() - t];
}

/* A fake HUD: polls like the glasses, answers each new push with `answer`. */
function hudLoop(token, { answer = ['got', 'playing'], legacy = false, everyMs = 2000, ua = GLASSES_UA } = {}) {
  let stop = false;
  let last = -1;
  const seen = [];
  (async () => {
    while (!stop) {
      const query = legacy ? { code: token } : { code: token, who: 'hud', b: 'testbuild', i: 'abc123', vis: 'visible' };
      const d = await call(pairApi, 'GET', { query, ua });
      if (d.ok && d.dest && d.destSeq !== last) {
        last = d.destSeq;
        seen.push(d.destSeq);
        const seq = d.destSeq;
        (async () => {
          for (let i = 0; i < answer.length; i++) {
            if (i) await sleep(1000);
            const b = legacy
              ? { code: token, ack: seq }
              : { code: token, ack: seq, state: answer[i], detail: answer[i] === 'failed' ? 'Your glasses are not on the same WiFi as your phone.' : '', b: 'testbuild', who: 'hud' };
            await call(pairApi, 'POST', { body: b, ua });
          }
        })();
      }
      await sleep(everyMs);
    }
  })();
  return { stop() { stop = true; }, seen };
}

/* ---------------- assertions ---------------- */

const results = [];
function check(mode, name, cond, note) {
  results.push({ mode, name, ok: !!cond, note: note || '' });
  console.log((cond ? 'PASS' : 'FAIL') + '  [' + mode + '] ' + name + (note ? '  -- ' + note : ''));
}
const noUnpairWords = s => !/expired|not active/i.test(String(s || ''));
const brief = o => JSON.stringify({ ok: o.ok, error: o.error, delivery: o.delivery, moved: o.moved });

/* ---------------- scenarios ---------------- */

async function runMigrated() {
  const M = 'migrated';
  backend.reset(true);
  deliveryReset();

  // (a) mint
  const a = await mint();
  check(M, '(a) mint returns code and token', a.ok && a.code && /^[a-f0-9]{64}$/.test(a.token));
  const tok = a.token;
  await call(pairApi, 'POST', { body: { code: a.code, touch: true }, ua: IPHONE_UA });

  // (b)+(c) fake HUD loop answering got, then playing after 1s
  let hud = hudLoop(tok);
  await sleep(2200);
  const row = findRow(tok);
  check(M, '(b) HUD poll records check-in and build', row.hud_seen_at && row.hud_build === 'testbuild' && row.hud_who === 'hud');
  let [c, ms] = await timed(push(tok));
  check(M, '(c) video push returns ok:true within 6s once playing', c.ok === true && ms < 6000 && c.delivery.state === 'playing',
    ms + 'ms ' + brief(c));
  check(M, '(c) delivery fields present', c.delivery && 'glassesSeenS' in c.delivery && c.delivery.glassesBuild === 'testbuild');
  hud.stop();
  await sleep(2100);

  // (d) pinch
  hud = hudLoop(tok, { answer: ['got', 'pinch'] });
  await sleep(500);
  [c, ms] = await timed(push(tok));
  check(M, '(d) pinch -> ok:false "Pinch to start"', c.ok === false && /Pinch to start/.test(c.error) && noUnpairWords(c.error), ms + 'ms ' + brief(c));
  hud.stop();
  await sleep(2100);

  // extra: failed with detail
  hud = hudLoop(tok, { answer: ['got', 'failed'] });
  await sleep(500);
  [c] = await timed(push(tok));
  check(M, '(x1) failed -> "could not play it: <detail>"', c.ok === false && /could not play it: Your glasses are not on the same WiFi/.test(c.error) && noUnpairWords(c.error), brief(c));
  hud.stop();
  await sleep(2100);

  // extra: hidden
  hud = hudLoop(tok, { answer: ['got', 'hidden'] });
  await sleep(500);
  [c] = await timed(push(tok));
  check(M, '(x2) hidden -> "starts when you look at GlassTube"', c.ok === false && /starts when you look/.test(c.error), brief(c));
  hud.stop();
  await sleep(2100);

  // extra: only got -> still starting, at the budget
  hud = hudLoop(tok, { answer: ['got'] });
  await sleep(500);
  [c, ms] = await timed(push(tok));
  check(M, '(x3) only got at timeout -> "still starting", inside the phone\'s 12s timeout',
    c.ok === false && /still starting/.test(c.error) && ms < 11000, ms + 'ms ' + brief(c));
  hud.stop();
  await sleep(2100);

  // extra: HUD polling (seen recently) but never answering -> not picked up
  const quietRow = findRow(tok);
  quietRow.hud_seen_at = Date.now();
  quietRow.hud_build = 'testbuild';
  [c, ms] = await timed(push(tok));
  check(M, '(x4) nothing at timeout -> "Not picked up yet"', c.ok === false && /Not picked up yet/.test(c.error) && ms < 11000, ms + 'ms ' + brief(c));
  findRow(tok).acked_seq = findRow(tok).dest_seq; // clear it

  // (e) glasses away: last check-in 50s ago
  findRow(tok).hud_seen_at = Date.now() - 50000;
  [c, ms] = await timed(push(tok));
  check(M, '(e) away -> ok:false "have not checked in", returned at once',
    c.ok === false && /have not checked in for about a minute/.test(c.error) && ms < 2000 && noUnpairWords(c.error), ms + 'ms ' + brief(c));
  const g = await call(pairApi, 'GET', { query: { code: tok, who: 'hud', b: 'testbuild' }, ua: GLASSES_UA });
  check(M, '(e) the push stays pending for the next poll', g.ok && g.dest && g.dest.id === '8WSyoITbP-c');
  await call(pairApi, 'POST', { body: { code: tok, ack: g.destSeq, state: 'got', b: 'testbuild', who: 'hud' }, ua: GLASSES_UA });

  // never seen at all
  const fresh = await mint();
  [c] = await timed(push(fresh.token));
  check(M, '(e2) never checked in -> "have not checked in yet"', c.ok === false && /have not checked in yet/.test(c.error), brief(c));

  // phone preview never counts as the glasses
  const pv = await mint();
  await call(pairApi, 'GET', { query: { code: pv.token, who: 'preview', b: 'testbuild' }, ua: IPHONE_UA });
  await call(pairApi, 'GET', { query: { code: pv.token }, ua: IPHONE_UA });
  check(M, 'phone HUD preview never sets hud_seen_at', findRow(pv.token).hud_seen_at === null);
  await call(pairApi, 'GET', { query: { code: pv.token, who: 'preview' }, ua: GLASSES_UA });
  check(M, 'who=preview wins over the user agent', findRow(pv.token).hud_seen_at === null);

  // (f) legacy HUD: no who, no b, Greatwhite UA, plain { code, ack }
  hud = hudLoop(tok, { legacy: true, answer: ['got'] });
  await sleep(2200);
  check(M, '(f) legacy poll still records check-in, with no build', findRow(tok).hud_seen_at && findRow(tok).hud_build === null && findRow(tok).hud_who === 'hud-legacy');
  [c, ms] = await timed(push(tok));
  check(M, '(f) legacy HUD -> ok:true immediately', c.ok === true && ms < 1500 && c.delivery.state === 'sent', ms + 'ms ' + brief(c));
  await sleep(2200);
  check(M, '(f) legacy ack still consumes the push', findRow(tok).acked_seq === findRow(tok).dest_seq && findRow(tok).ack_state === 'got');
  hud.stop();

  // (g) channels push is immediate
  [c, ms] = await timed(push(tok, { url: '', channels: [{ id: 'UC' + 'x'.repeat(22), name: 'Test' }] }));
  check(M, '(g) channels push returns at once', c.ok === true && c.kind === 'channels' && ms < 1000 && !c.delivery, ms + 'ms');
  [c, ms] = await timed(call(pushApi, 'POST', { body: { code: tok, kind: 'session', session: 'x' } }));
  check(M, '(g) session push returns at once', c.ok === true && ms < 1000, ms + 'ms');

  // (h) supersede
  const old = await mint();
  await call(pairApi, 'POST', { body: { code: old.code, touch: true }, ua: IPHONE_UA });
  const nu = await mint({ replaces: old.token });
  check(M, '(h) mint with replaces returns a new code', nu.ok && nu.code !== old.code);
  c = await call(pairApi, 'POST', { body: { code: old.token, touch: true }, ua: IPHONE_UA });
  check(M, '(h) touch on the replaced link -> "not active"', c.ok === false && /not active/.test(c.error), brief(c));
  c = await push(old.token);
  check(M, '(h) push on the replaced link -> "not active"', c.ok === false && /not active/.test(c.error), brief(c));
  c = await call(pairApi, 'POST', { body: { code: nu.code, touch: true }, ua: IPHONE_UA });
  check(M, '(h) the new code is unaffected', c.ok === true);
  await mint({ replaces: old.code });
  check(M, '(h) a 6-character code is never superseded', findRow(old.code).superseded_by === nu.code);

  // unknown state is refused, and a late 'got' never undoes 'playing'
  c = await call(pairApi, 'POST', { body: { code: tok, ack: 1, state: 'bogus', who: 'hud' }, ua: GLASSES_UA });
  check(M, 'unknown state refused', c.ok === false);
  const r = findRow(tok);
  await call(pairApi, 'POST', { body: { code: tok, ack: 77, state: 'playing', who: 'hud' }, ua: GLASSES_UA });
  await call(pairApi, 'POST', { body: { code: tok, ack: 77, state: 'got', who: 'hud' }, ua: GLASSES_UA });
  check(M, 'late got does not undo playing', r.ack_seq === 77 && r.ack_state === 'playing');
}

async function runLegacy(flavour) {
  const M = 'legacy-' + flavour;
  backend.reset(false, flavour);
  deliveryReset();

  const a = await mint();
  check(M, '(a) mint works without the migration', a.ok && a.code && a.token);
  const tok = a.token;
  await call(pairApi, 'POST', { body: { code: a.code, touch: true }, ua: IPHONE_UA });

  const hud = hudLoop(tok, { answer: ['got', 'playing'] });
  await sleep(2200);
  check(M, '(b) new-build HUD polls fine through glasstube_poll', (backend.calls.glasstube_poll || 0) >= 1);
  let [c, ms] = await timed(push(tok));
  check(M, '(c) push -> today\'s immediate ok:true', c.ok === true && ms < 1500 && c.delivery.state === 'unknown', ms + 'ms ' + brief(c));
  await sleep(2500);
  check(M, '(b) got/playing reports consume through glasstube_ack', findRow(tok).acked_seq === findRow(tok).dest_seq && (backend.calls.glasstube_ack || 0) >= 1);
  hud.stop();

  findRow(tok).hud_seen_at = null;
  [c, ms] = await timed(push(tok));
  check(M, '(e) no "not checked in" without the migration (no data)', c.ok === true && ms < 1500, ms + 'ms');
  const g = await call(pairApi, 'GET', { query: { code: tok, who: 'hud', b: 'x' }, ua: GLASSES_UA });
  check(M, '(e) push pending for the next poll', g.ok && g.dest);
  await call(pairApi, 'POST', { body: { code: tok, ack: g.destSeq }, ua: GLASSES_UA });

  const lg = hudLoop(tok, { legacy: true, answer: ['got'] });
  await sleep(2200);
  [c, ms] = await timed(push(tok));
  check(M, '(f) legacy loop -> ok:true immediately', c.ok === true && ms < 1500, ms + 'ms');
  lg.stop();

  [c, ms] = await timed(push(tok, { url: '', channels: [{ id: 'UC' + 'x'.repeat(22), name: 'Test' }] }));
  check(M, '(g) channels push at once', c.ok === true && ms < 1000, ms + 'ms');

  const nu = await mint({ replaces: tok });
  check(M, '(h) mint with replaces still mints', nu.ok && nu.code);
  c = await call(pairApi, 'POST', { body: { code: tok, touch: true }, ua: IPHONE_UA });
  check(M, '(h) touch on the old link behaves as today (no supersede data)', c.ok === true);

  const newCalls = NEW_FNS.reduce((n, f) => n + (backend.calls[f] || 0), 0);
  check(M, 'missing functions are remembered: at most one failing call', newCalls <= 1 && deliveryStatus().ready === false,
    'new-fn calls=' + newCalls + ' ' + JSON.stringify(deliveryStatus()));
  check(M, 'no request errored', results.filter(r => r.mode === M && !r.ok).length === 0);
}

const which = process.argv[2] || 'all';
const t0 = Date.now();
if (which === 'all' || which === 'legacy') {
  await runLegacy('supabase');
  await runLegacy('berth');
}
if (which === 'all' || which === 'migrated') await runMigrated();
const failed = results.filter(r => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed in ' + Math.round((Date.now() - t0) / 1000) + 's');
process.exit(failed.length ? 1 : 0);
