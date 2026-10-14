const $ = s => document.querySelector(s);

const DPAD = {
  UP: 'ArrowUp', DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft', RIGHT: 'ArrowRight',
  SELECT: 'Enter',
};
const BACK_KEYS = ['Escape', 'Backspace', 'BrowserBack', 'GoBack'];
const isBackKey = k => BACK_KEYS.indexOf(k) !== -1;

const DEFAULT_CHANNELS = [
  { name: 'TED Talks', id: 'UCAuUUnT6oDeKwE6v1NGQxug' },
  { name: 'NASA', id: 'UCLA_DiR1FfKNvjuUpBHmylQ' },
  { name: 'Veritasium', id: 'UCHnyfMqiRRG1u-2MsSQLbXA' },
  { name: 'Kurzgesagt', id: 'UCsXVk37bltHxD1rDPwtNM8Q' },
  { name: 'Vsauce', id: 'UC6nSFpj9HTCZ5t-N3Rm3-HA' },
  { name: 'MKBHD', id: 'UCBJycsmduvYEL83R_U4JriQ' },
];

const MAX_LIST = 40;
const CHANNEL_PAGE = 8;
const MAX_RECENTS = 24;
/* Pairing poll (WP1). One request in flight at a time, each aborted after
   POLL_TIMEOUT_MS. The gap follows the wearer: fast while they are active or
   on From iPhone, slower when idle, slow but never stopped when the page says
   it is hidden (whether the glasses report hidden truthfully is unverified). */
const POLL_ACTIVE_MS = 2000;
const POLL_IDLE_MS = 5000;
const POLL_HIDDEN_MS = 15000;
const POLL_TIMEOUT_MS = 8000;
const POLL_BACKOFF_MS = [2000, 4000, 8000, 15000];
const POLL_NOW_MS = 100;
const POLL_FRESH_MS = 1000;
const ACTIVE_WINDOW_MS = 180000;
const WATCHDOG_MS = 10000;
const WATCHDOG_STALL_MS = 30000;
/* A link is wiped only after GONE_STRIKES dead answers spanning GONE_SPAN_MS. */
const GONE_STRIKES = 3;
const GONE_SPAN_MS = 30000;
/* Self-update: reload into a new deploy only on idle Home or on resume. */
const UPDATE_IDLE_MS = 20000;
const UPDATE_PUSH_QUIET_MS = 60000;
const UPDATE_RETRY_MS = 10 * 60 * 1000;
const UPDATE_CHECK_MS = 5000;
const RELOADED_FOR_KEY = 'glasstube.reloadedFor';
const UPDATED_FROM_KEY = 'glasstube.updatedFrom';
const BUILD_CHIP_MS = 3000;
const UNLINK_ARM_MS = 4000;
const PAIR_NEW_LABEL = 'Link a different phone';
const RETRY_MS = 3000;
const PUSH_FRESH_MS = 10 * 60 * 1000;
const ROUTE_KEY = 'glasstube.route';
const RECENTS_KEY = 'glasstube.recents';
const PAIR_KEY = 'glasstube.pair';
const LINK_KEY = 'glasstube.link';
const PLAYLISTS_KEY = 'glasstube.playlists';
const PROGRESS_KEY = 'glasstube.progress';
const CHANNELS_KEY = 'glasstube.channels';
const SESSION_KEY = 'glasstube.session';
// When the running sleep timer ends (ms), so a reload resumes it, not restarts it.
const SLEEP_UNTIL_KEY = 'glasstube.sleepUntil';
const MARKS_KEY = 'glasstube.marks';
const QUERIES_KEY = 'glasstube.queries';
/* A video counts as finished, not resumable, this close to the end. */
const NEAR_END_S = 15;
/* The iPhone build that first sends a playable file (u). Anything older can
   pair and push titles but can never hand over video, which is exactly the
   silent failure this guard exists to name. */
const MIN_PHONE_APP = 1.25;
const sound = (typeof GlassSound !== 'undefined') ? GlassSound : null;
const prefs = (typeof GlassPrefs !== 'undefined') ? GlassPrefs : null;

const screens = {
  home: $('#screen-home'),
  list: $('#screen-list'),
  player: $('#screen-player'),
  phone: $('#screen-phone'),
  settings: $('#screen-settings'),
  debug: $('#screen-debug'),
  search: $('#screen-search'),
};

let current = 'home';
let queue = [];
let queueIndex = -1;
let pairCode = '';
let pairLink = '';
let pairTimer = null;
let pairLastSeq = -1;
let pairReplaces = ''; // WP6: link token a fresh mint replaces
let pairMintTimer = 0;
let pairState = 'not paired';
let feedHealth = 'not called yet';
let feedWait = '';
let nowPlaying = null;
let netOffline = false;
let loadRetry = 0;
let wayChain = [];
let wayPos = 0;
let wayFor = '';
let skipIds = {};
let playFails = [];
let blockedFor = '';
let needGesture = false;
// WP5: one counter per openPlayer call; every player timer checks it.
let openSeq = 0;
let stallWatch = 0;
let proxyDemoted = false;
let routeSaved = '';
let progressAt = 0;
let loadText = '';
// Phone files by video id, in memory only: { u, exp }. Never persisted.
const fileFor = {};
let sleepUntil = 0;
let sleepWatch = 0;
let channelPage = 0;
let listKind = '';
let ytSession = '';
let library = null;
let libraryErr = '';
let lastQuery = '';
let phoneApp = '';
/* Poll loop and self-update state (WP1). lastKeyAt and lastActiveAt are the
   shared activity clocks: any keydown, becoming visible and an applied push
   move them. */
let pollBusy = false;
let pollAgain = false;
let pollDueAt = 0;
let pollStartedAt = 0;
let pollCtrl = null;
let pollFails = 0;
let lastPoll = { at: 0, ok: false, text: 'not yet' };
let lastActiveAt = Date.now();
let lastKeyAt = Date.now();
let lastPushAt = 0;
let goneStrikes = 0;
let goneFirstAt = 0;
let pairSeqKey = '';
let serverBuild = '';
let updatePending = '';
let updatedFrom = '';
let unlinkArmed = 0;
const instanceId = (Math.random().toString(36) + '000000').slice(2, 8);

function report(text) {
  if (window.glasstubeReport) window.glasstubeReport(text);
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + String(r).padStart(2, '0');
}

function channelsLoad() {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    if (raw === null) return DEFAULT_CHANNELS.slice();
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return DEFAULT_CHANNELS.slice();
    return list.filter(c => c && c.id && c.name).slice(0, 24);
  } catch (e) {
    return DEFAULT_CHANNELS.slice();
  }
}

function channelsSave(list) {
  const next = (list || []).filter(c => c && c.id).slice(0, 24).map(c => ({
    name: String(c.name || 'Channel').slice(0, 80),
    id: String(c.id),
  }));
  try { localStorage.setItem(CHANNELS_KEY, JSON.stringify(next)); }
  catch (e) { /* private mode */ }
  return next;
}

function recentsLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function recentsSave(list) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS))); }
  catch (e) { /* private mode */ }
}

/* List rows are 160x90, so the 320x180 mqdefault is all they need. The larger
   hq, sd and maxres images cost several times the bytes on a slow link. */
function mqThumb(url, id) {
  const u = String(url || '');
  if (!u) return id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : '';
  const m = u.match(/^(https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/[^/?#]+\/)(?:hqdefault|sddefault|maxresdefault|hq720)\.(jpg|webp)(?:[?#].*)?$/);
  return m ? m[1] + 'mqdefault.' + m[2] : u;
}

function recentsAdd(video) {
  const next = recentsLoad().filter(v => v && v.id !== video.id);
  next.unshift({
    id: video.id,
    title: video.title || 'YouTube video',
    channel: video.channel || '',
    thumb: mqThumb(video.thumb, video.id),
  });
  recentsSave(next);
}

/* Where each video got to, kept per id so leaving a long talk halfway and
   coming back a day later lands in the right place. */
function marksLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(MARKS_KEY) || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (e) { return {}; }
}

function markSet(id, t, duration) {
  if (!id) return;
  const marks = marksLoad();
  if (!t || t < 10 || (duration && duration - t < NEAR_END_S)) delete marks[id];
  else marks[id] = { t: Math.floor(t), d: Math.floor(duration || 0), at: Date.now() };
  const keys = Object.keys(marks).sort(function (a, b) {
    return (marks[b].at || 0) - (marks[a].at || 0);
  }).slice(0, 60);
  const next = {};
  keys.forEach(function (k) { next[k] = marks[k]; });
  try { localStorage.setItem(MARKS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
}

function resumeAt(id) {
  const m = marksLoad()[id];
  // Leaving a video in its first seconds stores no mark, but 'Resume' on the
  // row it lands on must still pick up where the wearer left (WP7).
  if (exitPoint && exitPoint.id === id && (!m || (m.at || 0) <= exitPoint.at)) return exitPoint.t;
  return (m && m.t) || 0;
}

function markLabel(id) {
  const m = marksLoad()[id];
  if (!m || !m.t) return '';
  if (!m.d) return 'at ' + fmtTime(m.t);
  return Math.round((m.t / m.d) * 100) + '% watched';
}

function sessionLoad() {
  try { return localStorage.getItem(SESSION_KEY) || ''; }
  catch (e) { return ''; }
}

function sessionStore(blob) {
  ytSession = String(blob || '');
  try {
    if (ytSession) localStorage.setItem(SESSION_KEY, ytSession);
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* optional */ }
  if (typeof Player !== 'undefined' && Player.setSession) Player.setSession(ytSession);
}

function queriesLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUERIES_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(function (q) { return typeof q === 'string' && q; }) : [];
  } catch (e) { return []; }
}

function queriesAdd(q) {
  const text = String(q || '').trim();
  if (!text) return;
  const next = [text].concat(queriesLoad().filter(function (x) {
    return x.toLowerCase() !== text.toLowerCase();
  })).slice(0, 8);
  try { localStorage.setItem(QUERIES_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
}

/* WP4: durable pairing. The key is written everywhere: localStorage plus a
   year-long cookie, and a launch URL may carry it as ?pair=, so a storage
   wipe on the glasses no longer drops the phone. Read order: URL, then
   localStorage, then the cookie. Unlinking while the launch URL still carries
   the old key marks that key ignored, or it would come back on the next
   launch and quietly move the glasses off the phone's pairing. */
const PAIR_RE = /^[A-Z0-9]{6}$|^[a-f0-9]{64}$/i;
const PAIR_COOKIE = 'glasstube_pair';
const IGNORE_PAIR_KEY = 'glasstube.ignoreUrlPair';
const IGNORE_PAIR_COOKIE = 'glasstube_ignore_pair';
const LINKED_KEY = 'glasstube.linked';
const TOUCH_KEY = 'glasstube.lastTouchAt';
const TOUCH_EVERY_MS = 6 * 60 * 60 * 1000;
let pairPaired = false;
let pairTouchAt = 0;

function lsGet(k) {
  try { return localStorage.getItem(k) || ''; }
  catch (e) { return ''; }
}

function pairNorm(v) {
  const t = String(v || '').trim();
  if (!PAIR_RE.test(t)) return '';
  return t.length === 6 ? t.toUpperCase() : t.toLowerCase();
}

function cookieGet(name) {
  try {
    const m = String(document.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  } catch (e) { return ''; }
}

function cookieSet(name, value) {
  try {
    document.cookie = name + '=' + encodeURIComponent(value || '') +
      '; Max-Age=' + (value ? 31536000 : 0) + '; Path=/; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  } catch (e) { /* cookies off */ }
}

function pairUrlRaw() {
  try { return pairNorm(new URLSearchParams(location.search).get('pair')); }
  catch (e) { return ''; }
}

function pairUrlIgnored() {
  const raw = pairUrlRaw();
  return !!raw && raw === pairNorm(lsGet(IGNORE_PAIR_KEY) || cookieGet(IGNORE_PAIR_COOKIE));
}

/* Every deliberate unlink, and a pairing the server says is gone. */
function pairIgnoreUrl() {
  const raw = pairUrlRaw();
  if (!raw) return;
  try { localStorage.setItem(IGNORE_PAIR_KEY, raw); } catch (e) { /* optional */ }
  cookieSet(IGNORE_PAIR_COOKIE, raw);
}

/* Once at boot: pick the key by the read order, then write it back to every
   store so they stay in step. */
function pairBoot() {
  let code = pairCodeStored();
  let link = linkStored();
  const url = pairUrlIgnored() ? '' : pairUrlRaw();
  if (url.length === 64 && url !== link) { link = url; code = ''; }
  else if (url.length === 6 && url !== code) { code = url; link = ''; }
  pairCode = code;
  pairCodeStore(code);
  linkStore(link);
  pairPaired = !!link && lsGet(LINKED_KEY) === '1';
}

/* The last poll said a phone has claimed this pair. Kept across reloads so
   the Home chip does not flash 'Not linked' at every launch. */
function pairPairedSet(v) {
  if (!!v === pairPaired) return;
  pairPaired = !!v;
  try { localStorage.setItem(LINKED_KEY, pairPaired ? '1' : '0'); } catch (e) { /* optional */ }
}

/* Keepalive only for a pair a phone already claimed, at most every 6h. The
   old every-8th-poll touch is what marked a fresh, untyped code 'paired'. */
function pairTouchMaybe() {
  const last = Math.max(pairTouchAt, Number(lsGet(TOUCH_KEY)) || 0);
  if (Date.now() - last < TOUCH_EVERY_MS) return;
  pairTouchAt = Date.now();
  try { localStorage.setItem(TOUCH_KEY, String(pairTouchAt)); } catch (e) { /* optional */ }
  fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: pairKey(), touch: true }),
  }).catch(() => {});
}

function pairCodeStored() {
  const c = lsGet(PAIR_KEY);
  if (c) return c;
  const k = pairNorm(cookieGet(PAIR_COOKIE));
  return k.length === 6 ? k : '';
}

function pairCodeStore(c) {
  try {
    if (c) localStorage.setItem(PAIR_KEY, c);
    else localStorage.removeItem(PAIR_KEY);
  } catch (e) { /* optional */ }
  cookieSet(PAIR_COOKIE, pairLink || c);
  pairKeyChanged();
}

/* destSeq belongs to one pairing key. When the key changes, the last seq seen
   under the old key means nothing, so the next push is judged afresh. */
function pairKeyChanged() {
  const k = pairKey();
  if (k === pairSeqKey) return;
  pairSeqKey = k;
  pairLastSeq = -1;
}

/* The six character code is a bootstrap and expires on purpose. The link token
   is the actual pairing: long, unguessable, and good for a year past the last
   time either device spoke. Talking to the server with the token is what stops
   the phone asking for a code again every time it reopens. */
function linkStored() {
  const t = lsGet(LINK_KEY);
  if (t) return t;
  const k = pairNorm(cookieGet(PAIR_COOKIE));
  return k.length === 64 ? k : '';
}

function linkStore(t) {
  pairLink = String(t || '');
  try {
    if (pairLink) localStorage.setItem(LINK_KEY, pairLink);
    else localStorage.removeItem(LINK_KEY);
  } catch (e) { /* optional */ }
  cookieSet(PAIR_COOKIE, pairLink || pairCodeStored());
  pairKeyChanged();
}

function pairKey() {
  return pairLink || pairCode;
}

/* Screens that Left (or the system Back) leaves. They show the '◀ Back'
   footer in place of the old focusable Back rows. Search is not one: there
   Left moves the letter cursor. */
const FOOT_SCREENS = { list: 1, phone: 1, settings: 1, debug: 1 };

function show(name) {
  // Home is only ever the root of the nav stack. A plain show('home') from
  // anywhere (sleep timer, older callers) pops the whole stack instead of
  // leaving entries that Back would walk into later.
  if (name === 'home' && !navRendering && navStack.length > 1) {
    navRoot();
    return;
  }
  if (current === 'player' && name !== 'player') {
    noteExit();
    playerUiReset();
    progressSave();
    if (typeof Player !== 'undefined') Player.destroy();
    nowPlaying = null;
  }
  current = name;
  document.body.classList.toggle('hud-player', name === 'player');
  Object.keys(screens).forEach(k => {
    if (screens[k]) screens[k].classList.toggle('hidden', k !== name);
  });
  setStatus('');
  const bar = $('#errbar');
  if (bar && name === 'player') {
    bar.classList.add('hidden');
    bar.textContent = '';
  }
  const foot = $('#nav-foot');
  if (foot) foot.classList.toggle('hidden', !FOOT_SCREENS[name]);
  document.body.classList.toggle('has-foot', !!FOOT_SCREENS[name]);
  if (name !== 'player') syncFades();
  if (name !== 'player') focusDefault();
}

function focusables() {
  const scr = screens[current];
  if (!scr) return [];
  return Array.prototype.slice.call(
    scr.querySelectorAll('.focusable:not([disabled])')
  ).filter(el => el.offsetParent !== null);
}

/* Lists are no longer capped at six rows, so the focused row has to be walked
   into view or the band scrolls into nothing the wearer can see. It is kept
   centred (block 'center'), never parked on the bottom edge. The target is
   computed against the row's own scroll body rather than with scrollIntoView,
   which would also try to scroll the stage, and so the edge fades can be set
   for where the scroll will end, not where a smooth scroll happens to be. */
function reveal(el) {
  if (!el) return;
  const body = el.closest ? el.closest('.screen-body') : null;
  if (!body || el.offsetParent !== body) {
    if (!el.scrollIntoView) return;
    try { el.scrollIntoView({ block: 'center' }); }
    catch (e) { el.scrollIntoView(false); }
    return;
  }
  const max = Math.max(0, body.scrollHeight - body.clientHeight);
  const top = Math.max(0, Math.min(max,
    Math.round(el.offsetTop - (body.clientHeight - el.offsetHeight) / 2)));
  if (Math.abs(body.scrollTop - top) > 1) body.scrollTo({ top: top });
  updateFades(body, top);
  thumbsNear(el);
}

/* The 32px edge fades show only while content continues past that edge. */
function updateFades(body, top) {
  if (!body) return;
  const t = top == null ? body.scrollTop : top;
  const max = body.scrollHeight - body.clientHeight;
  body.classList.toggle('fade-top', t > 1);
  body.classList.toggle('fade-bottom', t < max - 1);
}

function syncFades() {
  const scr = screens[current];
  if (!scr) return;
  scr.querySelectorAll('.screen-body').forEach(function (b) { updateFades(b); });
}

// Re-check the fades once any scroll settles (one call per scroll, not per
// frame), for scrolls that reveal() did not start.
document.querySelectorAll('.screen-body').forEach(function (b) {
  if ('onscrollend' in window) {
    b.addEventListener('scrollend', function () { updateFades(b); }, { passive: true });
    return;
  }
  let settle = 0;
  b.addEventListener('scroll', function () {
    clearTimeout(settle);
    settle = setTimeout(function () { updateFades(b); }, 150);
  }, { passive: true });
});

/* Thumbnails carry data-src and only rows within 6 of focus get a real src,
   so a 40-row list does not pull 40 images over the glasses' slow link. */
function thumbsNear(el, span) {
  const box = el && el.parentElement;
  if (!box) return;
  const rows = box.children;
  const idx = Math.max(0, Array.prototype.indexOf.call(rows, el));
  const n = span == null ? 6 : span;
  for (let i = Math.max(0, idx - n); i <= Math.min(rows.length - 1, idx + n); i++) {
    const img = rows[i].querySelector('img[data-src]');
    if (img && !img.getAttribute('src')) img.src = img.dataset.src;
  }
}

function focusFirst() {
  const f = focusables();
  if (f.length) {
    f[0].focus();
    reveal(f[0]);
  } else if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
}

/* Where a screen puts focus when it opens fresh. Lists start on the first
   video row (Play all stays above it, one Up away). From iPhone starts with
   nothing focused, so a stray pinch there can never unlink the phone. */
function focusDefault() {
  if (current === 'phone') {
    const a = document.activeElement;
    if (a && a !== document.body && a.blur) a.blur();
    return;
  }
  if (current === 'list') {
    const v = screens.list.querySelector('#list-items [data-video]');
    if (v && v.offsetParent !== null) {
      v.focus();
      reveal(v);
      return;
    }
  }
  focusFirst();
}

/* The stable identity of a row, so focus survives the list being rebuilt:
   a video id, a channel id, a home data-menu, or the element id. */
function focusKeyOf(el) {
  if (!el || !el.getAttribute) return '';
  return el.getAttribute('data-key') || el.getAttribute('data-menu') || el.id || '';
}

function moveFocus(dir) {
  const f = focusables();
  if (!f.length) return;
  const idx = f.indexOf(document.activeElement);
  if (idx === -1) { f[0].focus(); return; }
  const next = (dir === 'up' || dir === 'left')
    ? (idx > 0 ? idx - 1 : f.length - 1)
    : (idx < f.length - 1 ? idx + 1 : 0);
  f[next].focus();
  reveal(f[next]);
}

/* Right in a list: jump n rows, clamped at the ends, never wrapping. */
function moveFocusBy(n) {
  const f = focusables();
  if (!f.length) return;
  const idx = f.indexOf(document.activeElement);
  const next = idx < 0 ? 0 : Math.max(0, Math.min(f.length - 1, idx + n));
  f[next].focus();
  reveal(f[next]);
}

/* Pinch feedback: a 120ms press on whatever the pinch landed on. */
function pulse(el) {
  if (!el || !el.classList) return;
  el.classList.add('pressed');
  clearTimeout(el.pressTimer);
  el.pressTimer = setTimeout(function () { el.classList.remove('pressed'); }, 120);
}

function activateFocused() {
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('focusable')) return;
  pulse(el);
  el.click();
}

function setStatus(msg, isErr) {
  const el = $('#status');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
  el.classList.toggle('status-err', !!isErr);
}

/* One short message in the toast lane (y 500-548). kind 'ok', 'err' or 'info'
   picks the leading glyph (✓ ! ↓); CSS draws it, so textContent stays exactly
   the text. #toast sits outside the screens, so show() and route retries never
   clear it. Hides itself after ms (default 4s). */
let toastTimer = 0;
let toastFade = 0;

function showToast(text, kind, ms) {
  const el = $('#toast');
  if (!el) return;
  if (!text) { hideToast(true); return; }
  clearTimeout(toastTimer);
  clearTimeout(toastFade);
  const k = (kind === 'ok' || kind === 'err') ? kind : 'info';
  el.textContent = String(text);
  el.className = 'toast toast-' + k;
  toastTimer = setTimeout(hideToast, ms > 0 ? ms : 4000);
}

function hideToast(now) {
  const el = $('#toast');
  if (!el) return;
  clearTimeout(toastTimer);
  clearTimeout(toastFade);
  toastTimer = 0;
  const done = function () {
    el.className = 'toast hidden';
    el.textContent = '';
  };
  if (now === true || el.classList.contains('hidden')) { done(); return; }
  el.classList.add('toast-out');
  toastFade = setTimeout(done, 260);
}

function isNetErr(e) {
  return /failed to fetch|networkerror|offline|internet|load failed|not connected|HTTP 5/i
    .test(String((e && e.message) || e || ''));
}

function netText(e) {
  const s = String((e && e.message) || e || '');
  if (isNetErr(s)) return 'No internet. Retrying...';
  return s;
}

/* WP4: one failed poll is not 'offline'. Two in a row are, or the OS saying
   so. In the player the text is a toast, never the full-width bar, and it
   clears the moment a request gets through, playing or not. pollFails (WP1,
   declared with the poll loop state) is the one failure counter: it drives
   both the backoff and this threshold. */

function offlineText() {
  return navigator.onLine === false ? 'No internet' : 'Can\'t reach GlassTube · retrying';
}

function isOfflineText(t) {
  return /No internet|Can't reach GlassTube/i.test(String(t || ''));
}

function setOffline(on) {
  const was = netOffline;
  netOffline = !!on;
  if (on) {
    if (current === 'player') showToast(offlineText(), 'err', 16000);
    else setStatus(offlineText(), true);
  } else {
    const st = $('#status');
    if (st && isOfflineText(st.textContent)) setStatus('');
    const t = $('#toast');
    if (t && isOfflineText(t.textContent)) showToast('');
  }
  if (was !== netOffline) updateHomePhoneHint();
}

function netFail() {
  pollFails += 1;
  if (pollFails >= 2 || navigator.onLine === false) setOffline(true);
}

function netOk() {
  pollFails = 0;
  setOffline(false);
}

function renderSound() {
  const el = $('#sound-state');
  if (!el) return;
  el.textContent = (sound && sound.enabled()) ? 'On' : 'Off';
}

function yn(v) { return v ? 'On' : 'Off'; }

function renderSettings() {
  renderSound();
  if ($('#captions-state')) $('#captions-state').textContent = prefs ? yn(prefs.captions()) : 'Off';
  if ($('#speed-state')) $('#speed-state').textContent = prefs ? prefs.speedLabel() : '1x';
  if ($('#repeat-state')) $('#repeat-state').textContent = prefs ? prefs.repeatLabel() : 'Off';
  if ($('#shuffle-state')) $('#shuffle-state').textContent = prefs ? yn(prefs.shuffle()) : 'Off';
  if ($('#picture-state')) $('#picture-state').textContent = (prefs && prefs.audioOnly()) ? 'Audio only' : 'Video';
  if ($('#sleep-state')) {
    if (sleepUntil && Date.now() < sleepUntil) {
      const left = Math.max(1, Math.ceil((sleepUntil - Date.now()) / 60000));
      $('#sleep-state').textContent = left + ' min left';
    } else {
      $('#sleep-state').textContent = prefs ? prefs.sleepLabel() : 'Off';
    }
  }
  if (typeof Player !== 'undefined' && Player.applyAll) Player.applyAll();
}

function progressLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    return raw && raw.id ? raw : null;
  } catch (e) { return null; }
}

function progressSave() {
  if (!nowPlaying || typeof Player === 'undefined') return;
  progressAt = Date.now();
  const snap = Player.snapshot();
  if (snap.duration && snap.time > 1) markSet(nowPlaying.id, snap.time, snap.duration);
  if (!snap.duration || snap.time < 5) return;
  if (snap.duration - snap.time < NEAR_END_S) return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      id: nowPlaying.id,
      title: nowPlaying.title,
      channel: nowPlaying.channel || '',
      thumb: nowPlaying.thumb || '',
      t: Math.floor(snap.time),
      // Google signs an expiry into u, so a stored one is stale by the time
      // anyone taps Continue. Keep the list, drop the files.
      queue: queue.slice(0, 20).map(function (v) {
        const row = Object.assign({}, v);
        delete row.u;
        delete row.r;
        return row;
      }),
      queueIndex: queueIndex,
      listTitle: queueTitle(),
      at: Date.now(),
    }));
  } catch (e) { /* optional */ }
  renderContinue();
}

/* While playing, at most one save every 10s. Pause, ended, exit, hidden and
   pagehide save at once through progressSave(). */
function progressTick() {
  if (Date.now() - progressAt < 10000) return;
  progressSave();
}

function progressClear() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch (e) {}
  renderContinue();
}

function renderContinue() {
  const btn = $('#btn-continue');
  const sub = $('#continue-sub');
  if (!btn) return;
  const p = progressLoad();
  if (!p) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  // Continue carries the queue too, so Home needs no separate Queue row.
  const n = (p.queue || []).length;
  if (sub) {
    sub.textContent = n > 1
      ? (p.listTitle || 'Queue') + ' · ' + (Math.min(p.queueIndex || 0, n - 1) + 1) + '/' + n + ' · ' + fmtTime(p.t)
      : (p.title || 'Video') + ' · ' + fmtTime(p.t);
  }
}

function openContinue() {
  const p = progressLoad();
  if (!p) return;
  skipIds = {};
  if (p.queue && p.queue.length) {
    queue = p.queue.map(v => Object.assign({}, v, { _listTitle: p.listTitle || 'Continue' }));
    navPlayer(Math.min(p.queueIndex || 0, queue.length - 1), p.t);
  } else {
    queue = [Object.assign({}, p, { _listTitle: 'Continue' })];
    navPlayer(0, p.t);
  }
}

function shuffleList(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function maybeShuffle(videos) {
  if (prefs && prefs.shuffle() && videos.length > 1) return shuffleList(videos);
  return videos;
}

/* Starts the timer the wearer just picked. With resume (page load), only the
   deadline already saved counts: a timer that has run out, or none saved, goes
   back to Off instead of starting a fresh one. */
function armSleep(resume) {
  const mins = prefs ? prefs.sleep() : 0;
  let saved = 0;
  try { saved = Number(localStorage.getItem(SLEEP_UNTIL_KEY)) || 0; } catch (e) { /* private mode */ }
  sleepUntil = !mins ? 0 : resume ? (saved > Date.now() ? saved : 0) : Date.now() + mins * 60000;
  if (mins && !sleepUntil && prefs) prefs.setSleep(0);
  try {
    if (sleepUntil) localStorage.setItem(SLEEP_UNTIL_KEY, String(sleepUntil));
    else localStorage.removeItem(SLEEP_UNTIL_KEY);
  } catch (e) { /* private mode */ }
  if (sleepWatch) clearInterval(sleepWatch);
  sleepWatch = 0;
  if (!sleepUntil) {
    renderSettings();
    return;
  }
  sleepWatch = setInterval(function () {
    if (!sleepUntil) return;
    if (Date.now() >= sleepUntil) {
      sleepUntil = 0;
      if (sleepWatch) clearInterval(sleepWatch);
      sleepWatch = 0;
      // Once fired, sleep is Off everywhere: settings, the player menu, reload.
      if (prefs) prefs.setSleep(0);
      try { localStorage.removeItem(SLEEP_UNTIL_KEY); } catch (e) { /* private mode */ }
      if (menuIsOpen()) renderPlayerMenu();
      if (typeof Player !== 'undefined' && Player.pause) Player.pause();
      show('home');
      setStatus('Sleep timer ended.', false);
    }
    if (current === 'settings') renderSettings();
    else if (current === 'player') updateChrome();
  }, 15000);
}

function playlistsLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) { return []; }
}

function playlistsSave(list) {
  try { localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list.slice(0, 8))); }
  catch (e) { /* private mode */ }
}

function playlistRemember(name, videos) {
  if (!name || !videos || videos.length < 2) return;
  const next = playlistsLoad().filter(p => p && p.name !== name);
  next.unshift({
    name: String(name).slice(0, 80),
    videos: videos.map(v => ({
      id: v.id,
      title: v.title || 'YouTube video',
      channel: v.channel || '',
      thumb: mqThumb(v.thumb, v.id),
    })),
  });
  playlistsSave(next);
}

/* WP4: Home tells the truth about the link: a chip in the header and the
   From iPhone row's second line. Linked means a link token is held and the
   last poll said a phone claimed it. */
function pairLinked() {
  return !!pairLink && pairPaired;
}

function updateHomePhoneHint() {
  const el = document.querySelector('[data-menu="phone"] small');
  const chip = $('#link-chip');
  const linked = pairLinked();
  if (el) {
    let t = 'Getting a code…';
    if (netOffline) t = offlineText();
    else if (linked && lastPushInfo) t = 'iPhone linked · last video ' + agoText(Date.now() - lastPushInfo.at);
    else if (linked) t = 'iPhone linked';
    else if (pairCode) t = 'Code ' + pairCode + ' · waiting for iPhone';
    if (el.textContent !== t) el.textContent = t;
  }
  if (!chip) return;
  const state = netOffline ? 'err' : (linked ? 'on' : 'off');
  if (chip.dataset.state === state) return;
  chip.dataset.state = state;
  chip.className = 'link-chip link-' + state;
  const dot = document.createElement('span');
  dot.className = 'chip-dot';
  dot.textContent = { on: '●', off: '○', err: '!' }[state];
  chip.textContent = '';
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode({ on: ' Linked', off: ' Not linked', err: ' Offline' }[state]));
}

function renderHome() {
  updateHomePhoneHint();
  renderMissed();
  renderContinue();
  const lib = document.querySelector('[data-menu="library"]');
  if (lib) lib.classList.toggle('hidden', !ytSession);
  const sub = document.querySelector('[data-menu="library"] small');
  if (sub) sub.textContent = 'Subscriptions, playlists, liked';
}

/* ---- Navigation stack ----------------------------------------------------

   Every forward move is navTo(entry) and every Back pops, so Back returns to
   exactly the screen, row and scroll position the wearer left. An entry is
   { name, render, focusKey, focusIdx, scrollTop } and redraws itself from
   data it already holds, so going back never refetches. Home is depth 0.

   Browser history mirrors the stack: the root is seeded with replaceState and
   each level gets one pushState, at most HIST_MAX of them (the glasses cap
   history at 5 entries including the root). On firmware v125.1+ the
   middle-finger tap is history.back(), which arrives here as popstate - the
   same path ArrowLeft takes. Every navigation bumps navGen, and async loads
   drop their result when it moved, so a feed the wearer backed out of never
   takes over the screen later. */
const HIST_MAX = 4;
const homeEntry = { name: 'home', render: function () { renderHome(); show('home'); } };
let navStack = [homeEntry];
let navGen = 0;
let navRendering = false;
let navAfterRoot = null;

function navTop() { return navStack[navStack.length - 1]; }
function navDepth() { return navStack.length - 1; }

function histDepth() {
  const s = history.state;
  return s && s.gt ? (Number(s.d) || 0) : 0;
}

/* Remember where focus and scroll sit on the top entry before leaving it. */
function navSave() {
  const top = navTop();
  if (!top || top.name !== current || current === 'player') return;
  const f = focusables();
  const el = document.activeElement;
  const i = f.indexOf(el);
  top.focusKey = i >= 0 ? focusKeyOf(el) : '';
  top.focusIdx = i;
  const body = screens[current] && screens[current].querySelector('.screen-body');
  top.scrollTop = body ? body.scrollTop : 0;
}

function navRender(entry, restore) {
  navRendering = true;
  try { entry.render(entry); } finally { navRendering = false; }
  if (restore) navRestore(entry);
}

/* Focus by key, then by index, else the screen's own default (the first video
   row in a list, nothing on From iPhone). */
function navRestore(entry) {
  if (current === 'player' || current !== entry.name) return;
  const f = focusables();
  let el = null;
  if (entry.focusKey) el = f.filter(x => focusKeyOf(x) === entry.focusKey)[0] || null;
  if (!el && entry.focusIdx >= 0 && f.length) el = f[Math.min(entry.focusIdx, f.length - 1)];
  if (!el) return;
  const body = screens[current] && screens[current].querySelector('.screen-body');
  if (body && entry.scrollTop) body.scrollTop = entry.scrollTop;
  el.focus({ preventScroll: true });
  reveal(el);
}

/* After a push or a replace, make the current history entry say this depth.
   pushState only when history is exactly one level short; if it is already at
   or past this depth (an entry was dropped without moving history), replace. */
function navHistory() {
  const d = navDepth();
  const h = histDepth();
  try {
    if (h >= d) history.replaceState({ gt: 1, d: d }, '');
    else if (d <= HIST_MAX) history.pushState({ gt: 1, d: d }, '');
  } catch (e) { /* history is a nicety; ArrowLeft still pops the stack */ }
}

/* opts.replace swaps the top entry instead of stacking a new one (channel
   pages, a new push replacing an older one). Home is never replaced. */
function navTo(entry, opts) {
  const replace = !!(opts && opts.replace) && navStack.length > 1;
  navSave();
  navGen++;
  feedWait = '';
  if (replace) navStack[navStack.length - 1] = entry;
  else navStack.push(entry);
  navHistory();
  navRender(entry, false);
}

/* Redraw the top entry in place (new data arrived) and keep the wearer's row. */
function navRefresh() {
  navSave();
  navRender(navTop(), true);
}

function navPopTo(target) {
  target = Math.max(0, Math.min(target, navDepth()));
  const played = current === 'player' && nowPlaying ? nowPlaying.id : '';
  navGen++;
  feedWait = '';
  navStack.length = target + 1;
  const top = navTop();
  // Leaving the player lands on the row of the video that was playing, even
  // when the queue moved on from the one that was picked.
  if (played && top.videos && top.videos.some(v => v && v.id === played)) {
    top.focusKey = played;
    top.focusIdx = -1;
  }
  navRender(top, true);
  if (played) labelResumeRow(played);
  if (target === 0) navRunAfterRoot();
}

function homePulse() {
  pulse(document.querySelector('#screen-home .title-home'));
}

/* ArrowLeft and the back keys. Left on Home does nothing but a short pulse on
   the title, so repeated Lefts always settle on Home with focus kept. */
function goBack() {
  const depth = navDepth();
  if (depth <= 0) {
    if (current !== 'home') navRender(homeEntry, true);
    homePulse();
    return;
  }
  navGen++;
  feedWait = '';
  if (histDepth() === depth) {
    try { history.back(); return; } catch (e) { /* pop by hand below */ }
  }
  navPopTo(depth - 1);
  try { history.replaceState({ gt: 1, d: Math.min(navDepth(), histDepth()) }, ''); } catch (e) {}
}

function navRunAfterRoot() {
  const f = navAfterRoot;
  navAfterRoot = null;
  if (f) f();
}

/* Straight back to Home, history included. `after` runs once history is at
   the root - WP1's update reload must wait for that (a reload at depth > 0
   would leave stale same-page entries behind the new page). */
function navRoot(after) {
  const h = histDepth();
  if (navStack.length > 1 || current !== 'home') {
    navSave();
    navGen++;
    feedWait = '';
    navStack.length = 1;
    navRender(homeEntry, true);
  }
  if (h > 0) {
    navAfterRoot = after || null;
    try {
      history.go(-h);
      if (after) setTimeout(navRunAfterRoot, 800);
      return;
    } catch (e) { navAfterRoot = null; }
  }
  if (after) after();
}

window.addEventListener('popstate', function (e) {
  inputTestNote('popstate');
  const s = e.state;
  const depth = navDepth();
  let target = s && s.gt ? (Number(s.d) || 0) : 0;
  // Never pushState in here. A popstate that does not go below the current
  // depth (history got ahead of the stack) still counts as one Back.
  if (target >= depth) {
    if (depth === 0) { navRunAfterRoot(); return; }
    target = depth - 1;
    try { history.replaceState({ gt: 1, d: target }, ''); } catch (x) {}
  }
  navPopTo(target);
});

function navPlayer(index, startAt) {
  navTo({ name: 'player', render: function () { openPlayer(index, true, startAt); } });
}

function navVideoList(title, videos, kind, opts) {
  navTo({
    name: 'list', kind: kind || '', videos: videos,
    render: function () { showVideoList(title, videos, kind); },
  }, opts);
}

/* While a picked row's feed loads it shows a spinner and 'Loading…'. A row
   that is already loading ignores a second pinch. */
function rowLoading(key) {
  if (current !== 'list' || !key) return null;
  const rows = [].slice.call(document.querySelectorAll('#list-items [data-key]'));
  const row = rows.filter(r => r.getAttribute('data-key') === key)[0];
  if (!row) return null;
  if (!row.classList.contains('is-loading')) {
    row.classList.add('is-loading');
    const copy = row.querySelector('.list-copy') || row;
    const tag = document.createElement('span');
    tag.className = 'row-load';
    tag.innerHTML = '<span class="row-spin"></span>Loading…';
    copy.appendChild(tag);
  }
  return row;
}

function rowLoaded(row) {
  if (!row) return;
  row.classList.remove('is-loading');
  const tag = row.querySelector('.row-load');
  if (tag) tag.remove();
}

function queueTitle() {
  return queue.length && queue[0] && queue[0]._listTitle
    ? queue[0]._listTitle
    : 'Videos';
}

/* Back is ArrowLeft or the system Back (the nav stack), so lists carry no
   Back row. An empty list can offer one action row instead, which then has
   focus. Item fields used here: key (stable id for focus restore), video
   (a video row: default focus), count (counts toward the n/N in the title). */
function renderList(title, items, emptyText, kind, emptyAction) {
  listKind = kind || '';
  $('#list-title').textContent = title;
  const box = $('#list-items');
  box.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('div');
    p.className = 'empty-msg';
    const text = emptyText || 'Nothing here yet.';
    // A list still on its way gets the spinner, so it never reads as empty.
    if (/^(Searching|Loading)\b/.test(text)) {
      p.classList.add('empty-busy');
      const spin = document.createElement('span');
      spin.className = 'load-spin';
      p.appendChild(spin);
    }
    p.appendChild(document.createTextNode(text));
    box.appendChild(p);
    if (emptyAction) items = [Object.assign({ key: 'empty-action' }, emptyAction)];
  }
  if (items.length) {
    items.slice(0, MAX_LIST).forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'focusable list-btn' + (item.thumb ? ' has-shot' : '') +
        (item.cls ? ' ' + item.cls : '');
      if (item.key) btn.setAttribute('data-key', item.key);
      if (item.video) btn.setAttribute('data-video', '1');
      if (item.count) btn.setAttribute('data-count', '1');
      if (item.thumb) {
        const shot = document.createElement('span');
        shot.className = 'list-shot';
        const img = document.createElement('img');
        img.alt = '';
        img.decoding = 'async';
        img.dataset.src = mqThumb(item.thumb);
        shot.appendChild(img);
        if (item.progress) {
          const bar = document.createElement('span');
          bar.className = 'list-seen';
          bar.style.width = Math.max(3, Math.min(100, item.progress)) + '%';
          shot.appendChild(bar);
        }
        btn.appendChild(shot);
      }
      const copy = document.createElement('div');
      copy.className = 'list-copy';
      const label = document.createElement('span');
      label.className = 'list-label';
      label.textContent = item.label;
      copy.appendChild(label);
      if (item.sub) {
        const sub = document.createElement('small');
        sub.textContent = item.sub;
        copy.appendChild(sub);
      }
      btn.appendChild(copy);
      btn.addEventListener('click', item.onPick);
      box.appendChild(btn);
    });
    if (box.firstElementChild) thumbsNear(box.firstElementChild);
  }
  show('list');
  listCount();
}

/* 'n/N' to the right of the list title: the focused row among the counted
   rows (videos, channels, playlists; not Play all or paging rows). */
function listCount() {
  const el = $('#list-count');
  if (!el) return;
  const rows = [].slice.call(document.querySelectorAll('#list-items [data-count]'));
  if (rows.length < 2) { el.textContent = ''; return; }
  const i = rows.indexOf(document.activeElement);
  el.textContent = (i >= 0 ? (i + 1) + '/' : '') + rows.length;
}

{
  const listBox = $('#list-items');
  if (listBox) listBox.addEventListener('focusin', listCount);
}

function videoItems(videos, onPick) {
  return videos.map((v, i) => {
    const mark = marksLoad()[v.id];
    // 'Channel · 14:13 · 35% watched': the duration lives here, not in a
    // badge over the thumbnail, and view counts are left out.
    const bits = [];
    if (v.channel) bits.push(v.channel);
    if (v.duration) bits.push(v.duration);
    const seen = markLabel(v.id);
    if (seen) bits.push(seen);
    return {
      key: v.id,
      video: true,
      count: true,
      label: v.title || 'YouTube video',
      sub: bits.join(' · '),
      thumb: v.thumb,
      progress: mark && mark.d ? (mark.t / mark.d) * 100 : 0,
      onPick: () => onPick(i, v),
    };
  });
}

/* Showing a list never touches the queue. Only starting a video from it does,
   so browsing can never replace what is playing. */
function showVideoList(title, videos, kind) {
  const items = [];
  if (videos.length > 1) {
    items.push({
      key: 'play-all',
      label: 'Play all · ' + videos.length,
      cls: 'is-action',
      onPick: () => playFromList(title, videos, 0, true),
    });
  }
  items.push.apply(items, videoItems(videos, function (i) {
    playFromList(title, videos, i, false);
  }));
  renderList(title, items, 'No videos in this list.', kind);
}

function playFromList(title, videos, index, all) {
  skipIds = {};
  queue = videos.map(v => Object.assign({}, v, { _listTitle: title }));
  if (all) queue = maybeShuffle(queue);
  const v = queue[index];
  if (!v) return;
  navPlayer(index, resumeAt(v.id));
}

function setLoading(on, title, text) {
  const el = $('#load-gate');
  const msg = $('#load-gate-msg');
  const name = $('#load-gate-title');
  if (!el) return;
  el.classList.toggle('hidden', !on);
  if (on) setPlayGate(false);
  if (name) name.textContent = title || (nowPlaying && nowPlaying.title) || 'YouTube video';
  if (text) loadText = text;
  if (msg) msg.textContent = netOffline ? offlineText() : pushGateText(loadText || 'Loading video…');
  queuePlayerPaint();
}

/* The gate: a ring with 'Pinch to play' (or text), and an optional 22px line
   under it. A pushed video says where it came from. */
function setPlayGate(on, title, text, sub) {
  const gate = $('#play-gate');
  const name = $('#play-gate-title');
  const msg = $('#play-gate-msg');
  const below = $('#play-gate-sub');
  if (!gate) return;
  gate.classList.toggle('hidden', !on);
  if (on) {
    const load = $('#load-gate');
    if (load) load.classList.add('hidden');
    // WP6: the pushed video is waiting for a pinch.
    if (nowPlaying && deliveryFor(nowPlaying.id)) deliveryReport('pinch');
  }
  if (name) name.textContent = title || (nowPlaying && nowPlaying.title) || 'YouTube video';
  if (msg && on) msg.textContent = text || 'Pinch to play';
  if (below && on) {
    below.textContent = sub !== undefined ? sub
      : (nowPlaying && nowPlaying._pushed ? 'Sent from your iPhone' : '');
  }
  queuePlayerPaint();
}

/* Route memory. Whatever played last time is tried first next time, so a
   working setup stops paying for three dead attempts on every video. */
function savedRoute() {
  try {
    const r = localStorage.getItem(ROUTE_KEY) || '';
    if (!routeSaved) routeSaved = r;
    return Player.routes().indexOf(r) >= 0 ? r : '';
  } catch (e) { return ''; }
}

function rememberRoute(r) {
  if (!r || r === routeSaved) return;
  routeSaved = r;
  try { localStorage.setItem(ROUTE_KEY, String(r)); } catch (e) { /* private mode */ }
}

function buildRouteChain(video) {
  const chain = Player.routesFor(video);
  const first = savedRoute();
  // Route memory reorders the fallbacks, but it must never demote the phone
  // file. That route is strictly the best one when it is available - inline,
  // no YouTube chrome, works with audio-only - so a night spent on the embed
  // fallback should not cost it first place once a file shows up again.
  const floor = chain[0] === 'file' ? 1 : 0;
  const i = chain.indexOf(first);
  if (i > floor) {
    chain.splice(i, 1);
    chain.splice(floor, 0, first);
  }
  // A proxy that never produced metadata is not tried early again this
  // session; it moves to the end of the fallbacks.
  const p = chain.indexOf('proxy');
  if (proxyDemoted && p >= 0 && p < chain.length - 1) {
    chain.splice(p, 1);
    chain.push('proxy');
  }
  return chain;
}

/* Loading text that says what is happening and stays put: the phone file
   first, then 'Trying another way… (2 of 4)' for each fallback. */
function routeLoadText() {
  const r = wayChain[wayPos];
  if (wayPos === 0) return r === 'file' ? 'Getting video from your phone…' : 'Loading video…';
  return 'Trying another way… (' + (wayPos + 1) + ' of ' + wayChain.length + ')';
}

/* The phone file's expiry, from Google's expire= parameter, in ms. */
function fileExpiry(u) {
  const m = String(u || '').match(/[?&]expire=(\d+)/);
  return m ? Number(m[1]) * 1000 : 0;
}

function fileRemember(v) {
  if (!v || !v.id || !v.u) return;
  if (typeof Player !== 'undefined' && Player.isMediaUrl && !Player.isMediaUrl(v.u)) return;
  fileFor[v.id] = { u: String(v.u), exp: fileExpiry(v.u) };
}

/* A file the phone sent earlier this session, while it has over 10 minutes
   left. Continue, Recents, the queue and Missed all come through here. */
function fileReuse(v) {
  if (!v || !v.id || v.u) return;
  const f = fileFor[v.id];
  if (f && f.exp - Date.now() > 10 * 60 * 1000) v.u = f.u;
}

function routeLabel(r) {
  return {
    file: 'phone file',
    proxy: 'server',
    embed: 'YouTube embed',
    go: 'YouTube redirect',
  }[r] || r;
}

function phoneOutOfDate() {
  const n = parseFloat(String(phoneApp).split(' ')[0]);
  return !!phoneApp && Number.isFinite(n) && n < MIN_PHONE_APP;
}

function isDeadVideo(code) {
  return code === 2 || code === 100;
}

function diagSend(kind, extra) {
  try {
    fetch('/api/diag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        kind: kind,
        ua: navigator.userAgent,
        ref: document.referrer || '',
        origin: String(window.location.origin || ''),
        when: new Date().toISOString(),
      }, extra || {})),
    }).catch(function () { /* diagnostics only */ });
  } catch (e) { /* never break playback for telemetry */ }
}

function playFailNote(err, code) {
  const id = (nowPlaying && nowPlaying.id) || '?';
  const r = Player.lastRoute ? Player.lastRoute() : '?';
  playFails.unshift(id + ' · ' + r + ' · code ' + (code || '-') + ' · ' + (err || 'unknown'));
  playFails = playFails.slice(0, 12);
  diagSend('fail', { id: id, code: code || 0, route: r, err: String(err || '').slice(0, 120) });
}

/* One sentence the wearer can act on, not a stack trace floating in their
   field of view. */
function blockedText(code, err) {
  const text = String(err || '');
  const hasPhone = !!(nowPlaying && nowPlaying.u);
  if (code === 100) return 'That video is gone or private.';
  if (code === 2) return 'That video link is broken.';
  if (code === 101 || code === 150 || code === 153) {
    return 'The owner of this video blocked it from playing outside YouTube. Send a different one.';
  }
  if (phoneOutOfDate()) {
    return 'The GlassTube app on your iPhone is ' + phoneApp + ' and too old to send video. ' +
      'Update it to ' + MIN_PHONE_APP.toFixed(2) + ' or newer.';
  }
  if (/No file from the phone/i.test(text)) {
    return 'Your phone did not send a playable file. Open GlassTube on the iPhone, stay on WiFi, and send again.';
  }
  if (/Media error/i.test(text) && hasPhone) {
    return 'The file your phone sent would not play here. Put the glasses on the same WiFi as the phone and send again.';
  }
  if (/Media error/i.test(text)) {
    return 'YouTube would not hand this server the video. Send it from the iPhone app instead.';
  }
  return 'Nothing could play this one (' + (code || 'no code') + '). Try another video.';
}

/* The most informative failure among this video's attempts. fails are
   playFails rows: 'id · route · code N · error'. A refused or unplayable
   phone file says more than the fallbacks that failed after it. */
function bestFailText(fails, code, err) {
  const rows = (fails || []).map(String);
  const codeOf = function (row) {
    const m = row.match(/ · code (\d+) · /);
    return m ? Number(m[1]) : 0;
  };
  for (let i = 0; i < rows.length; i++) {
    const c = codeOf(rows[i]);
    if (c === 100 || c === 2 || c === 101 || c === 150 || c === 153) return blockedText(c, rows[i]);
  }
  if (phoneOutOfDate()) return blockedText(0, '');
  const fileRows = rows.filter(function (row) { return / · file · /.test(row); });
  if (fileRows.some(function (row) { return /expired|expire|\b410\b/i.test(row); })) {
    return 'The file from your phone expired. Send it again from your phone.';
  }
  if (fileRows.some(function (row) { return /\b403\b|Media error|no source|no progress/i.test(row); })) {
    return 'Your glasses aren\'t on the same WiFi as your phone. Join the same WiFi and send it again.';
  }
  if (fileRows.some(function (row) { return /No file from the phone/i.test(row); })) {
    return blockedText(0, 'No file from the phone');
  }
  return blockedText(code || 0, err || (rows[0] || ''));
}

function failsFor(id) {
  return playFails.filter(function (row) { return row.indexOf(id + ' · ') === 0; });
}

function skipUnplayable(err, code) {
  pushFailed();
  playFailNote(err, code);
  if (nowPlaying && nowPlaying.id) skipIds[nowPlaying.id] = true;
  for (let i = 1; i <= queue.length; i++) {
    const idx = (queueIndex + i) % queue.length;
    const v = queue[idx];
    if (v && v.id && !skipIds[v.id]) {
      showToast('Skipped one YouTube would not play.', 'info');
      openPlayer(idx, true);
      return;
    }
  }
  setLoading(false);
  setPlayGate(false);
  blockedFor = (nowPlaying && nowPlaying.id) || '';
  stallStop();
  // The message replaces the picture, so nothing may keep playing under it.
  if (typeof Player !== 'undefined' && Player.pause) Player.pause();
  const why = bestFailText(failsFor(blockedFor), code, err);
  $('#player-error').textContent = queue.length > 1
    ? 'Nothing in this list would play. ' + why
    : why;
  $('#player-error').classList.remove('hidden');
  // WP6: the final error, in WP5's bestFailText sentence the wearer sees.
  if (nowPlaying && deliveryFor(nowPlaying.id)) deliveryReport('failed', why);
  showRelayOffer();
  const nextAct = $('#player-action-next');
  if (nextAct) nextAct.classList.toggle('hidden', queue.length < 2);
  updateChrome();
}

/* Quietly move to the next route for this video. Returns true when another
   attempt is coming, false when the chain is exhausted. */
function tryNextWay(videoId, err, code) {
  if (!videoId || isDeadVideo(code) || wayFor !== videoId) return false;
  if (loadRetry) return true;
  // The gate is waiting for a pinch: the route is not failing, the browser
  // is. Hold here; the pinch decides.
  if (needGesture || (typeof Player !== 'undefined' && Player.autoplayBlocked && Player.autoplayBlocked())) {
    return true;
  }
  if (wayPos + 1 >= wayChain.length) return false;
  playFailNote(err, code);
  wayPos += 1;
  stallStop();
  const seq = openSeq;
  loadRetry = setTimeout(function () {
    if (seq !== openSeq) return;
    loadRetry = 0;
    if (current === 'player' && nowPlaying && nowPlaying.id === videoId) {
      openPlayer(queueIndex, true, resumeAt(videoId), { retry: true });
    }
  }, 500 + wayPos * 250);
  return true;
}

function openPlayer(index, autoplay, startAt, opts) {
  if (index < 0 || index >= queue.length) return;
  opts = opts || {};
  queueIndex = index;
  shuffleMark(index);
  const video = queue[index];
  const openId = ++openSeq;
  stallStop();
  fileReuse(video);
  if (!opts.retry) {
    if (loadRetry) {
      clearTimeout(loadRetry);
      loadRetry = 0;
    }
    wayChain = buildRouteChain(video);
    wayPos = 0;
    wayFor = video.id;
  }
  if (blockedFor && blockedFor !== video.id) blockedFor = '';
  if (current !== 'player') legendCount();
  playerUiReset();
  nowPlaying = video;
  deliveryVideo(video.id);
  recentsAdd(video);
  $('#player-title').textContent = video.title || 'YouTube video';
  $('#player-channel').textContent = playerSubLine();
  $('#player-error').classList.add('hidden');
  $('#player-time').textContent = '0:00 / 0:00';
  paintBar(0, 0);
  needGesture = false;
  setPlayGate(false);
  setLoading(true, video.title, routeLoadText());
  show('player');
  if (typeof Player === 'undefined') {
    $('#player-error').textContent = 'Player script missing.';
    $('#player-error').classList.remove('hidden');
    return;
  }
  const attempt = wayPos;
  const route = wayChain[wayPos] || 'proxy';
  Player.setHandlers(onVideoEnded, updateChrome, playerEvent);
  hudNote('route', { route: route, attempt: attempt, chain: wayChain.join('>'), hasU: !!video.u });
  Player.load(video, autoplay, startAt || 0, route).then(function (ok) {
    if (openId !== openSeq) return;
    hudNote('loaded', { route: route, ok: !!ok, err: ok ? '' : String(Player.lastError() || ''),
      code: Player.lastCode ? Player.lastCode() : 0 });
    if (!ok) {
      const err = Player.lastError() || 'Could not start this route.';
      const code = Player.lastCode ? Player.lastCode() : 0;
      if (!tryNextWay(video.id, err, code)) skipUnplayable(err, code);
    } else {
      setOffline(false);
    }
    updateChrome();
    if (!ok || !autoplay) return;
    // Diagnostics only. The gate comes from a refused play(), not a timer.
    setTimeout(function () {
      if (openId !== openSeq || current !== 'player') return;
      const snap = Player.snapshot();
      hudNote('check3s', { route: route, playing: !!snap.playing, paused: !!snap.paused,
        error: snap.error || '', time: snap.time, readyState: snap.readyState,
        buffered: Math.round((snap.buffered || 0) * 10) / 10, playRejected: snap.playRejected || '',
        blocked: !!snap.blocked });
    }, 3000);
    stallStart(openId, video, route);
  });
}

/* Once a second until this attempt has played: give the route up only on
   evidence (Player.stallReason), and never while the gate waits. */
function stallStart(openId, video, route) {
  stallStop();
  stallWatch = setInterval(function () {
    if (openId !== openSeq || current !== 'player') {
      stallStop();
      return;
    }
    const snap = Player.snapshot();
    if (snap.hasPlayed) {
      stallStop();
      return;
    }
    if (needGesture || snap.blocked) return;
    const why = Player.stallReason ? Player.stallReason() : '';
    if (!why) return;
    stallStop();
    hudNote('stalled', { route: route, time: snap.time, why: why, readyState: snap.readyState });
    if (route === 'proxy' && /metadata/.test(why)) proxyDemoted = true;
    if (!tryNextWay(video.id, routeLabel(route) + ' ' + why, 0)) {
      skipUnplayable(routeLabel(route) + ' ' + why, 0);
    }
  }, 1000);
}

function stallStop() {
  if (stallWatch) clearInterval(stallWatch);
  stallWatch = 0;
}

/* Events the player raises beyond state changes. */
function playerEvent(kind) {
  if (current !== 'player') return;
  if (kind === 'muted') {
    showToast('Sound off · pinch for sound', 'info', 8000);
    return;
  }
  if (kind === 'blocked') {
    needGesture = true;
    if (loadRetry) {
      clearTimeout(loadRetry);
      loadRetry = 0;
    }
    setPlayGate(true, nowPlaying && nowPlaying.title, 'Pinch to play');
    hudNote('autoplay-blocked', { route: Player.lastRoute ? Player.lastRoute() : '' });
    return;
  }
  if (kind === 'pause' || kind === 'ended') progressSave();
}

/* The index the next video would come from, or -1 at the end of the list.
   Repeat All wraps, but a queue pushed from the phone never does (WP7).
   pick=true lets shuffle choose; false gives the predictable neighbour. */
/* WP7: shuffle visits every video in the queue once. When all have played it
   ends the list like the in-order path does (Finished), unless Repeat all is
   on and the queue was not pushed from the phone, which never wraps. The
   shuffled pick is chosen once per (queue, position) so the 'Next: …' line,
   the menu and the actual advance all name the same video. */
var shuffleSeen = { q: null, ids: new Set() };
var shufflePeek = null;

function shuffleMark(index) {
  if (shuffleSeen.q !== queue) shuffleSeen = { q: queue, ids: new Set() };
  const v = queue[index];
  if (v) shuffleSeen.ids.add(v.id);
}

function shufflePick() {
  if (shufflePeek && shufflePeek.q === queue && shufflePeek.from === queueIndex) return shufflePeek.n;
  shuffleMark(queueIndex);
  let pool = [];
  queue.forEach((v, i) => { if (i !== queueIndex && !shuffleSeen.ids.has(v.id)) pool.push(i); });
  const pushed = !!(queue[0] && queue[0]._pushed);
  if (!pool.length && prefs && prefs.repeat() === 'all' && !pushed) {
    shuffleSeen.ids = new Set();
    queue.forEach((v, i) => { if (i !== queueIndex) pool.push(i); });
  }
  const n = pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
  shufflePeek = { q: queue, from: queueIndex, n };
  return n;
}

function nextIndex(pick) {
  if (!queue.length) return -1;
  if (prefs && prefs.shuffle() && queue.length > 1) return shufflePick();
  if (queueIndex + 1 < queue.length) return queueIndex + 1;
  const pushed = !!(queue[0] && queue[0]._pushed);
  if (prefs && prefs.repeat() === 'all' && queue.length > 1 && !pushed) return 0;
  return -1;
}

/* A deliberate skip (the player menu's Next, or the error screen's swipe
   down). It keeps each video's resume point. */
function playNext() {
  if (!queue.length) return;
  const n = nextIndex(true);
  if (n < 0) {
    showToast('End of list', 'info');
    return;
  }
  openPlayer(n, true, resumeAt(queue[n] && queue[n].id));
}

/* Previous on the first video restarts it instead of wrapping. */
function playPrev() {
  if (queueIndex <= 0) {
    restartVideo();
    return;
  }
  const prev = queueIndex - 1;
  openPlayer(prev, true, resumeAt(queue[prev] && queue[prev].id));
}

/* The video ran out: repeat one, a 5s 'Up next' card, or 'Finished'. */
function onVideoEnded() {
  if (current !== 'player') return;
  if (prefs && prefs.repeat() === 'one') {
    openPlayer(queueIndex, true);
    return;
  }
  const n = nextIndex(true);
  if (n >= 0) startUpNext(n);
  else showFinished();
}

/* WP4: what happens to each push the HUD receives.

   - A stale one (the server says so, or, with no stale field, its ts is older
     than 10 minutes by this clock) waits on Home as 'Missed from iPhone'. The
     last 3 are kept for 24h. The phone's file URL is never persisted; the live
     push stays in memory for this page's life.
   - One that lands while the page is hidden is held, and plays on the next
     visible event or the first key press.
   - The rest play at once, with a receipt toast that route retries cannot
     clear. lastPushInfo records what came of the latest one. */
const MISSED_KEY = 'glasstube.missed';
const MISSED_MAX = 3;
const MISSED_TTL_MS = 24 * 60 * 60 * 1000;
const LAST_PUSH_KEY = 'glasstube.lastPush';
const PUSH_START_TEXT = 'From your iPhone · starting…';
const IDLE_HOME_MS = 5000;
let missedMem = {};
let pendingPush = null;
let pushStartId = '';
let pushStartAt = 0;
let lastPushInfo = lastPushLoad();

function agoText(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : d + ' days ago';
}

function pushVideos(dest) {
  return (dest && dest.videos && dest.videos.length) ? dest.videos : [dest || {}];
}

function pushTitle(dest) {
  const vids = pushVideos(dest);
  const first = (vids[0] && vids[0].title) || (dest && dest.title) || 'YouTube video';
  if (vids.length < 2) return first;
  const name = dest.playlist && dest.playlist !== 'From iPhone' ? dest.playlist : first;
  return name + ' · ' + vids.length + ' videos';
}

/* When the phone sent it, on this clock. The server's ageS beats its ts. */
function pushSentAt(dest, gotAt) {
  const age = Number(dest && dest.ageS);
  if (dest && dest.ageS != null && Number.isFinite(age)) return gotAt - age * 1000;
  const ts = Number(dest && dest.ts);
  return ts > 0 ? ts : gotAt;
}

function pushIsStale(dest) {
  if (dest && dest.stale != null) return dest.stale === true;
  return !!(dest && dest.ts) && Date.now() - Number(dest.ts) > PUSH_FRESH_MS;
}

function lastPushLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_PUSH_KEY) || 'null');
    return v && v.at ? v : null;
  } catch (e) { return null; }
}

function lastPushSave(info) {
  lastPushInfo = info;
  try { localStorage.setItem(LAST_PUSH_KEY, JSON.stringify(info)); } catch (e) { /* private mode */ }
  if (current === 'phone') renderPhone();
}

function lastPushText() {
  const p = lastPushInfo;
  if (!p) return '';
  return 'Last from iPhone: ' + p.title + ' · ' + agoText(Date.now() - p.at) +
    (p.outcome ? ' · ' + p.outcome : '');
}

function lastPushMine() {
  return !!(lastPushInfo && nowPlaying && (lastPushInfo.ids || []).indexOf(nowPlaying.id) >= 0);
}

function lastPushOutcome(outcome) {
  if (!lastPushInfo || lastPushInfo.outcome === outcome) return;
  lastPushSave(Object.assign({}, lastPushInfo, { outcome: outcome }));
}

/* From updateChrome: the video on screen is really playing. */
function pushPlayed() {
  pushStartId = '';
  if (lastPushMine() && lastPushInfo.outcome !== 'played' && lastPushInfo.outcome !== 'missed') {
    lastPushOutcome('played');
  }
}

/* From skipUnplayable: no route could play it. */
function pushFailed() {
  if (lastPushMine() && !lastPushInfo.outcome) lastPushOutcome('couldn\'t play');
}

/* setLoading keeps the receipt on the load gate while a push starts. */
function pushGateText(text) {
  if (wayPos === 0 && !/Buffering/.test(text) && pushStartId && nowPlaying && nowPlaying.id === pushStartId &&
      Date.now() - pushStartAt < 60000) return PUSH_START_TEXT;
  return text;
}

function missedLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(MISSED_KEY) || '[]');
    const since = Date.now() - MISSED_TTL_MS;
    return Array.isArray(raw)
      ? raw.filter(function (m) { return m && m.id && m.key && Number(m.at) > since; })
      : [];
  } catch (e) { return []; }
}

function missedSave(list) {
  try { localStorage.setItem(MISSED_KEY, JSON.stringify(list.slice(0, MISSED_MAX))); }
  catch (e) { /* private mode */ }
}

function missedAdd(dest, sentAt) {
  const vids = pushVideos(dest).filter(function (v) { return v && v.id; });
  if (!vids.length) return;
  const at = sentAt || pushSentAt(dest, Date.now());
  const key = vids[0].id + '@' + Math.round(at);
  missedMem[key] = dest;
  const entry = {
    key: key, at: at, id: vids[0].id, title: vids[0].title || dest.title || '',
    channel: vids[0].channel || '', thumb: vids[0].thumb || '',
    playlist: dest.playlist || '', app: dest.app || '',
    videos: vids.slice(0, 50).map(function (v) {
      return { id: v.id, title: v.title || '', channel: v.channel || '', thumb: v.thumb || '' };
    }),
  };
  missedSave([entry].concat(missedLoad().filter(function (m) { return m.key !== key; })));
}

function missedTake(key) {
  missedSave(missedLoad().filter(function (m) { return m.key !== key; }));
}

/* The top Home row. Only the newest missed push shows; the next one takes
   its place once it is played. */
function renderMissed() {
  const btn = $('#btn-missed');
  if (!btn) return;
  const m = missedLoad()[0];
  const was = !btn.classList.contains('hidden');
  btn.classList.toggle('hidden', !m);
  if (!m) {
    if (was && document.activeElement === btn && current === 'home') focusFirst();
    return;
  }
  const title = pushTitle(m);
  const sub = 'Sent ' + agoText(Date.now() - m.at) + ' · pinch to play';
  if ($('#missed-title').textContent !== title) $('#missed-title').textContent = title;
  if ($('#missed-sub').textContent !== sub) $('#missed-sub').textContent = sub;
}

function openMissed() {
  const m = missedLoad()[0];
  if (!m) { renderHome(); return; }
  const dest = missedMem[m.key] || m;
  missedTake(m.key);
  delete missedMem[m.key];
  playPush(Object.assign({}, dest), m.at, true);
}

function pushMissed(dest, sentAt) {
  missedAdd(dest, sentAt);
  lastPushSave({ title: pushTitle(dest), at: sentAt, outcome: 'missed',
    ids: pushVideos(dest).slice(0, 50).map(function (v) { return v && v.id; }) });
  renderHome();
  if (current === 'home' && Date.now() - lastKeyAt > IDLE_HOME_MS) {
    const btn = $('#btn-missed');
    if (btn && !btn.classList.contains('hidden')) {
      btn.focus();
      reveal(btn);
    }
  }
}

function playPush(dest, sentAt, quiet) {
  applyPush(dest);
  lastPushSave({ title: pushTitle(dest), at: sentAt || Date.now(), outcome: '',
    ids: queue.slice(0, 50).map(function (v) { return v.id; }) });
  pushStartId = (nowPlaying && nowPlaying.id) || '';
  pushStartAt = Date.now();
  if (!quiet) showToast('From your iPhone · ' + pushTitle(dest), 'info', 3000);
  const msg = $('#load-gate-msg');
  if (msg && current === 'player' && !netOffline) msg.textContent = PUSH_START_TEXT;
}

/* pollPair hands over each new destSeq here, after the ack. */
function handlePush(dest, seq, special) {
  const gotAt = Date.now();
  const first = pushVideos(dest)[0] || {};
  const ageS = dest.ageS != null ? Number(dest.ageS)
    : (dest.ts ? Math.round((gotAt - Number(dest.ts)) / 1000) : null);
  const stale = !special && pushIsStale(dest);
  const held = !special && !stale && !!document.hidden;
  hudNote('push', { seq: seq, stale: stale, held: held, ageS: ageS,
    hasU: !!(dest.u || first.u) });
  if (special) {
    // WP6: channels, channel and session pushes stay immediate on the server.
    deliveryReport('got');
    if (deliveryPush) deliveryPush.done = true;
    applyPush(dest);
    return;
  }
  const sentAt = pushSentAt(dest, gotAt);
  if (stale) {
    pushMissed(dest, sentAt);
    // WP6: 'missed' replaces 'got' for a stale push (it still consumes it).
    deliveryReport('missed', 'stale');
    return;
  }
  deliveryReport('got');
  if (held) {
    if (pendingPush) pushMissed(pendingPush.dest, pendingPush.sentAt);
    pendingPush = { dest: dest, sentAt: sentAt, seq: seq };
    deliveryReport('hidden');
    return;
  }
  playPush(dest, sentAt);
}

/* A held push plays when the wearer can see it. If it went stale while
   held, it waits on Home instead of starting out of nowhere. */
function releasePendingPush() {
  if (!pendingPush) return false;
  const p = pendingPush;
  pendingPush = null;
  if (Date.now() - p.sentAt > PUSH_FRESH_MS) {
    pushMissed(p.dest, p.sentAt);
    // WP6: only the push being tracked; a newer push has taken over otherwise.
    if (deliveryPush && deliveryPush.seq === p.seq) deliveryReport('missed', 'held');
  } else {
    playPush(p.dest, p.sentAt);
  }
  return true;
}

/* A push from the phone. It can carry videos, a channel list, a channel to
   open, or the phone's Google session so the glasses can search.

   It deliberately does NOT navigate away any more. The old build jumped the
   whole HUD to the phone's plain-HTTP relay page, which threw away the queue,
   the settings and every Neural Band binding. The relay is still honoured, but
   only as something the wearer chooses from the error screen. */
function applyPush(dest) {
  if (!dest) return;
  lastPushAt = Date.now();
  lastActiveAt = lastPushAt;
  if (dest.kind === 'session') {
    sessionStore(dest.session || '');
    library = null;
    showToast(dest.session ? 'Signed in from your iPhone' : 'Signed out from your iPhone', 'ok');
    renderHome();
    return;
  }
  if (dest.kind === 'channels') {
    channelsSave(dest.channels || []);
    if (listKind === 'channels' && current === 'list') navRefresh();
    showToast('Channels updated from your iPhone', 'ok');
    return;
  }
  if (dest.kind === 'channel' && dest.id) {
    loadChannel({ id: dest.id, name: dest.name || 'Channel' });
    showToast('From your iPhone · ' + (dest.name || 'Channel'), 'info', 3000);
    return;
  }
  if (dest.app) phoneApp = String(dest.app);
  const list = (dest.videos && dest.videos.length) ? dest.videos : [dest];
  const name = dest.playlist || 'From iPhone';
  skipIds = {};
  // A single-video push carries its file at the top level, not on the row.
  if (dest.u || dest.r) {
    list.forEach(function (v) {
      if (!v || (!dest.id || v.id === dest.id)) {
        if (v && !v.u && dest.u) v.u = dest.u;
        if (v && !v.r && dest.r) v.r = dest.r;
      }
    });
  }
  list.forEach(fileRemember);
  const ordered = maybeShuffle(list);
  // The pushed list goes on the nav stack under the player, so Back lands on
  // it with the played row focused. Navigate before replacing the queue:
  // leaving a playing video saves its progress against its own queue.
  navPushList(name, ordered);
  queue = ordered.map(v => Object.assign({}, v, { _listTitle: name, _pushed: true }));
  playlistRemember(name, list);
  diagSend('push', {
    id: (queue[0] && queue[0].id) || '',
    hasU: !!(queue[0] && queue[0].u),
    hasR: !!(queue[0] && queue[0].r),
    origin: String(window.location.origin || ''),
  });
  navPlayer(0, resumeAt(queue[0] && queue[0].id));
}

/* A push replaces what is playing rather than stacking on it: the player on
   top (and an older pushed list under it) are swapped out, so a second push
   never makes Back walk through the first one. */
function navPushList(title, videos) {
  if (navStack.length > 1 && navTop().name === 'player') navStack.pop();
  navVideoList(title, videos, 'push', { replace: navTop().kind === 'push' });
}

/* The phone's LAN relay is plain HTTP and the HUD is HTTPS, so it can never be
   an inline <video>. Handing it over means leaving the HUD, which is a real
   cost - so it is an explicit choice on the error screen, never automatic. */
function relayUrlFor(video) {
  const r = String((video && video.r) || '');
  return /^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d+\/s\/[a-zA-Z0-9_-]{11}$/.test(r) ? r : '';
}

function openRelay() {
  const r = relayUrlFor(nowPlaying);
  if (!r) return;
  const ids = queue.map(relayUrlFor).filter(Boolean)
    .map(function (u) { return u.split('/s/')[1]; });
  const hash = ids.length > 1 ? '#' + ids.join(',') : '';
  progressSave();
  location.replace(r.replace('/s/', '/p/') + hash);
}

function updateChrome() {
  if (current !== 'player' || typeof Player === 'undefined') return;
  const snap = Player.snapshot();
  queuePlayerPaint();
  setText('#player-time', fmtTime(snap.time) + ' / ' + fmtTime(snap.duration));
  paintBar(snap.duration ? snap.time / snap.duration : 0, snap.duration ? snap.buffered / snap.duration : 0);
  setText('#player-channel', playerSubLine());
  // The legend is static copy in index.html; 'Next: …' is ellipsized by CSS.
  const nxt = queue.length > 1 ? queue[nextIndex(false)] : null;
  setText('#player-next', nxt && nxt.title ? 'Next: ' + nxt.title : '');
  const title = nowPlaying && nowPlaying.title;
  const scr = screens.player;
  if (!(snap.buffering && snap.time > 0.4)) {
    bufferSince = 0;
    if (scr) scr.classList.remove('rebuffer', 'stall');
  }
  if (snap.playing) {
    needGesture = false;
    finished = false;
    setLoading(false);
    setPlayGate(false);
    $('#player-error').textContent = '';
    $('#player-error').classList.add('hidden');
    hideRelayOffer();
    const bar = $('#errbar');
    if (bar) {
      bar.textContent = '';
      bar.classList.add('hidden');
    }
    if (loadRetry) {
      clearTimeout(loadRetry);
      loadRetry = 0;
    }
    rememberRoute(snap.route);
    progressTick();
    pushPlayed();
    // WP6: the first 'playing' of the pushed video confirms the delivery.
    if (nowPlaying && deliveryFor(nowPlaying.id)) deliveryReport('playing');
  } else if (snap.error) {
    needGesture = false;
    const id = nowPlaying && nowPlaying.id;
    const code = Player.lastCode ? Player.lastCode() : 0;
    if (id && blockedFor === id) {
      setLoading(false);
      setPlayGate(false);
      showRelayOffer();
      return;
    }
    if (needGesture || snap.blocked) {
      setPlayGate(true, title, 'Pinch to play');
    } else if (id && tryNextWay(id, snap.error, code)) {
      setLoading(true, title, routeLoadText());
    } else if (id) {
      skipUnplayable(snap.error, code);
    }
  } else if (nowPlaying && blockedFor === nowPlaying.id) {
    // Every route failed: the final error stays, never 'Loading'.
    setLoading(false);
    setPlayGate(false);
    showRelayOffer();
  } else if (snap.paused || snap.ended) {
    needGesture = false;
    if (upNextIdx >= 0) setPlayGate(false);
    else if (finished) setPlayGate(true, title, 'Finished', 'Pinch to replay · swipe left to exit');
    else setPlayGate(true, title, 'Pinch to play', '');
  } else if (needGesture || snap.blocked) {
    setPlayGate(true, title, 'Pinch to play');
  } else if (snap.buffering && snap.time > 0.4) {
    // A short rebuffer stays invisible; one over 1s shows the spinner and chrome.
    if (!bufferSince) bufferSince = Date.now();
    if (scr) {
      scr.classList.add('rebuffer');
      scr.classList.toggle('stall', Date.now() - bufferSince > 1000);
    }
    setLoading(true, title, 'Buffering…');
  } else {
    // Keep whatever the route said ('Getting video from your phone…').
    setLoading(true, title);
  }
}

function showRelayOffer() {
  const box = $('#player-relay');
  if (!box) return;
  box.classList.toggle('hidden', !relayUrlFor(nowPlaying));
}

function hideRelayOffer() {
  const box = $('#player-relay');
  if (box) box.classList.add('hidden');
}

/* ---- WP7: player chrome, dimming, seek feedback, menu, up next, exit ----
   Only the video is lit while it plays. Any swipe brings the top and bottom
   bands back for 3s; the gate, a pause, an error and a long stall keep them.
   UI timers tick at most once a second, never per frame. */
let exitPoint = null; // { id, t, at } of the video the wearer just left
let chromeTimer = 0;
let paintTimer = 0;
let bufferSince = 0;
let seekDir = 0;
let seekAt = 0;
let seekStep = 0;
let seekTimer = 0;
let leaveArmedAt = 0;
let menuTimer = 0;
let upNextTimer = 0;
let upNextIdx = -1;
let upNextLeft = 0;
let finished = false;
const CHROME_HOLD_MS = 3000;
const FINISHED_HOLD_MS = 10000;
const LEAVE_WINDOW_MS = 2500;
const MENU_IDLE_MS = 6000;
const UPNEXT_S = 5;
const LEGEND_KEY = 'glasstube.legend';
const LEGEND_SESSIONS = 3;

function setText(sel, text) {
  const el = $(sel);
  if (el && el.textContent !== text) el.textContent = text;
}

/* Fill and buffer are scaleX transforms; the knob rides on translateX. */
function paintBar(frac, bufFrac) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const b = Math.max(0, Math.min(1, bufFrac || 0));
  const fill = $('#player-fill');
  const buf = $('#player-buffer');
  const knob = $('#player-knob');
  const bar = $('#player-bar');
  if (fill) fill.style.transform = 'scaleX(' + f.toFixed(4) + ')';
  if (buf) buf.style.transform = 'scaleX(' + b.toFixed(4) + ')';
  if (knob) knob.style.transform = 'translateX(' + Math.round(f * ((bar && bar.clientWidth) || 552)) + 'px)';
}

/* 'Channel · 2 of 5 · 1.5x · Sleep 12m' */
function playerSubLine() {
  const bits = [];
  if (nowPlaying && nowPlaying.channel) bits.push(nowPlaying.channel);
  if (queue.length > 1 && queueIndex >= 0) bits.push((queueIndex + 1) + ' of ' + queue.length);
  if (prefs && prefs.speed() !== 1) bits.push(prefs.speedLabel());
  if (sound && !sound.enabled()) bits.push('Sound off');
  if (sleepUntil) bits.push('Sleep ' + Math.max(1, Math.ceil((sleepUntil - Date.now()) / 60000)) + 'm');
  return bits.join(' · ');
}

function playerFault() {
  return !!(nowPlaying && blockedFor && blockedFor === nowPlaying.id);
}

function menuIsOpen() {
  const m = $('#player-menu');
  return !!(m && !m.classList.contains('hidden'));
}

/* The first few times in the player, the gesture legend shows with the
   chrome; after that only while paused. */
function legendCount() {
  try {
    const n = Number(localStorage.getItem(LEGEND_KEY) || 0) || 0;
    if (n <= LEGEND_SESSIONS) localStorage.setItem(LEGEND_KEY, String(n + 1));
  } catch (e) { /* private mode */ }
}

function legendFresh() {
  try { return (Number(localStorage.getItem(LEGEND_KEY) || 0) || 0) <= LEGEND_SESSIONS; }
  catch (e) { return false; }
}

function queuePlayerPaint() {
  if (paintTimer) return;
  paintTimer = setTimeout(function () {
    paintTimer = 0;
    paintPlayer();
  }, 0);
}

/* The load gate is on screen: shown, and not a short rebuffer (which the
   stylesheet hides until it lasts over 1s). */
function loadGateShown() {
  const scr = screens.player;
  const load = $('#load-gate');
  return !!(load && !load.classList.contains('hidden')) &&
    !(scr && scr.classList.contains('rebuffer') && !scr.classList.contains('stall'));
}

/* States that keep the chrome up: the gate, a pause, the final error, a
   stall over 1s, the up next card, and loading before the first frame. */
function chromeSticky(snap) {
  const gate = $('#play-gate');
  const gateOn = !!(gate && !gate.classList.contains('hidden')) && !finished;
  return gateOn || loadGateShown() || !!snap.paused || playerFault() || upNextIdx >= 0;
}

function paintPlayer() {
  const scr = screens.player;
  if (!scr || current !== 'player' || typeof Player === 'undefined') return;
  const snap = Player.snapshot();
  const gate = $('#play-gate');
  const gateOn = !!(gate && !gate.classList.contains('hidden'));
  const fault = playerFault();
  scr.classList.toggle('fault', fault);
  scr.classList.toggle('dim', gateOn || loadGateShown() || !!snap.paused || menuIsOpen() || fault || finished || upNextIdx >= 0);
  scr.classList.toggle('legend', !!snap.paused || legendFresh());
  if (chromeSticky(snap)) {
    scr.classList.add('chrome-on');
    if (chromeTimer && !finished) {
      clearTimeout(chromeTimer);
      chromeTimer = 0;
    }
  } else if (scr.classList.contains('chrome-on') && !chromeTimer) {
    armChromeHide(CHROME_HOLD_MS);
  }
}

function armChromeHide(ms) {
  if (chromeTimer) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(function () {
    chromeTimer = 0;
    const scr = screens.player;
    if (current !== 'player' || !scr || typeof Player === 'undefined') return;
    const snap = Player.snapshot();
    if (chromeSticky(snap)) return;
    // Hidden only while the picture plays (or the list has finished); paint
    // re-arms this when playback resumes.
    if (snap.playing || finished) scr.classList.remove('chrome-on');
  }, ms || CHROME_HOLD_MS);
}

function chromeShow() {
  const scr = screens.player;
  if (!scr) return;
  scr.classList.add('chrome-on');
  armChromeHide(CHROME_HOLD_MS);
  queuePlayerPaint();
}

/* Everything WP7 adds is per video; a new video or leaving starts clean. */
function playerUiReset() {
  closePlayerMenu();
  cancelUpNext();
  finished = false;
  bufferSince = 0;
  leaveArmedAt = 0;
  if (chromeTimer) clearTimeout(chromeTimer);
  chromeTimer = 0;
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = 0;
  setText('#player-seek', '');
  const scr = screens.player;
  if (scr) {
    scr.classList.remove('dim', 'fault', 'upnext', 'menu-open', 'rebuffer', 'stall');
    scr.classList.add('chrome-on');
  }
  const nextAct = $('#player-action-next');
  if (nextAct) nextAct.classList.add('hidden');
  hideRelayOffer();
}

/* Where the wearer left, so the list can say 'Resume · 12:34'. Near the end
   counts as finished, so it resumes from the start. */
function noteExit() {
  if (!nowPlaying || !nowPlaying.id || typeof Player === 'undefined') return;
  const snap = Player.snapshot();
  let t = snap.time || 0;
  if (snap.ended || (snap.duration && snap.duration - t < NEAR_END_S)) t = 0;
  exitPoint = { id: nowPlaying.id, t: Math.floor(t), at: Date.now() };
}

/* Leaving the player lands on the row that was playing (WP3's navPopTo
   focuses it by data-key); this labels it 'Resume · 12:34'. */
function labelResumeRow(id) {
  if (!id || current !== 'list') return;
  const rows = document.querySelectorAll('#list-items [data-key]');
  let row = null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].dataset.key === id) { row = rows[i]; break; }
  }
  if (!row) return;
  const t = resumeAt(id);
  if (t < 1) return;
  const copy = row.querySelector('.list-copy');
  let sub = copy && copy.querySelector('small');
  if (copy && !sub) {
    sub = document.createElement('small');
    copy.appendChild(sub);
  }
  if (sub) sub.textContent = 'Resume · ' + fmtTime(t);
}

/* Seek with feedback: '+10s' in the bottom band for 900ms. Repeats in the
   same direction within 1s go to 30s, then 60s. */
function seekBy(dir) {
  if (typeof Player === 'undefined') return;
  const now = Date.now();
  if (dir === seekDir && now - seekAt < 1000) seekStep = seekStep >= 30 ? 60 : 30;
  else seekStep = 10;
  seekDir = dir;
  seekAt = now;
  Player.seek(dir * seekStep);
  setText('#player-seek', (dir > 0 ? '+' : '−') + seekStep + 's');
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = setTimeout(function () {
    seekTimer = 0;
    setText('#player-seek', '');
  }, 900);
  updateChrome();
}

function restartVideo() {
  if (typeof Player === 'undefined') return;
  finished = false;
  cancelUpNext();
  Player.seek(-1e7);
  const snap = Player.snapshot();
  if (snap.paused || snap.ended) Player.toggle();
  setPlayGate(false);
  updateChrome();
}

/* Pinch: play or pause. When WP5 muted playback by policy, a pinch turns the
   sound on instead of pausing. */
function playerPinch() {
  if (typeof Player === 'undefined') return;
  // WP5: a policy mute turns sound on (the arbiter already ran Player.unlock
  // inside this gesture) and hides the 'Sound off' toast.
  if (Player.mutedByPolicy()) {
    needGesture = false;
    Player.unmute();
    if (/^Sound off/.test(($('#toast') || {}).textContent || '')) hideToast();
    updateChrome();
    return;
  }
  if (finished) {
    finished = false;
    setPlayGate(false);
    openPlayer(0, true, 0);
    return;
  }
  needGesture = false;
  Player.toggle();
  setPlayGate(false);
  updateChrome();
}

/* Left is guarded: the first one shows the chrome and asks; a second within
   2.5s leaves. System Back (a back key, or WP3's popstate) leaves at once. */
function guardedLeave() {
  const now = Date.now();
  if (leaveArmedAt && now - leaveArmedAt < LEAVE_WINDOW_MS) {
    leaveArmedAt = 0;
    leavePlayer();
    return;
  }
  leaveArmedAt = now;
  chromeShow();
  showToast('Swipe left again to leave', 'info', LEAVE_WINDOW_MS);
}

function leavePlayer() {
  leaveArmedAt = 0;
  showToast('');
  goBack();
}

/* ---- Up next and the end of the list --------------------------------- */

function startUpNext(n) {
  cancelUpNext();
  const v = queue[n];
  if (!v) return;
  upNextIdx = n;
  upNextLeft = UPNEXT_S;
  setText('#upnext-title', 'Up next: ' + (v.title || 'YouTube video'));
  setText('#upnext-count', String(upNextLeft));
  if (screens.player) screens.player.classList.add('upnext');
  setPlayGate(false);
  chromeShow();
  upNextTimer = setInterval(function () {
    upNextLeft -= 1;
    if (upNextLeft <= 0) {
      playUpNext();
      return;
    }
    setText('#upnext-count', String(upNextLeft));
  }, 1000);
}

function playUpNext() {
  const n = upNextIdx;
  cancelUpNext();
  if (n >= 0 && queue[n]) openPlayer(n, true, resumeAt(queue[n].id));
}

function cancelUpNext() {
  if (upNextTimer) clearInterval(upNextTimer);
  upNextTimer = 0;
  upNextIdx = -1;
  if (screens.player) screens.player.classList.remove('upnext');
}

function showFinished() {
  cancelUpNext();
  finished = true;
  setLoading(false);
  setPlayGate(true, nowPlaying && nowPlaying.title, 'Finished', 'Pinch to replay · swipe left to exit');
  const scr = screens.player;
  if (scr) scr.classList.add('chrome-on');
  armChromeHide(FINISHED_HOLD_MS);
  queuePlayerPaint();
}

/* ---- Player menu: Down opens it over the dimmed video ------------------ */

function renderPlayerMenu() {
  const n = queue.length > 1 ? nextIndex(false) : -1;
  const nextRow = document.querySelector('#player-menu [data-act="next"]');
  if (nextRow) nextRow.classList.toggle('pm-off', n < 0);
  setText('#pm-next', n >= 0 ? (n + 1) + ' of ' + queue.length : '');
  setText('#pm-speed', prefs ? prefs.speedLabel() : '1x');
  setText('#pm-sound', sound && !sound.enabled() ? 'Off' : 'On');
  setText('#pm-picture', prefs && prefs.audioOnly() ? 'Audio only' : 'Video');
  const mins = prefs ? prefs.sleep() : 0;
  setText('#pm-sleep', mins ? (prefs.sleepLabel ? prefs.sleepLabel() : mins + 'm') : 'Off');
}

function armMenuIdle() {
  if (menuTimer) clearTimeout(menuTimer);
  menuTimer = setTimeout(function () {
    menuTimer = 0;
    closePlayerMenu();
  }, MENU_IDLE_MS);
}

function openPlayerMenu() {
  const m = $('#player-menu');
  if (!m) return;
  renderPlayerMenu();
  m.classList.remove('hidden');
  if (screens.player) screens.player.classList.add('menu-open');
  const first = m.querySelector('[data-act="next"]');
  if (first) first.focus();
  armMenuIdle();
  queuePlayerPaint();
}

function closePlayerMenu() {
  const m = $('#player-menu');
  if (menuTimer) clearTimeout(menuTimer);
  menuTimer = 0;
  if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  if (screens.player) screens.player.classList.remove('menu-open');
  const a = document.activeElement;
  if (a && m.contains(a) && a.blur) a.blur();
  if (current === 'player') chromeShow();
}

function menuKey(k) {
  const m = $('#player-menu');
  const rows = Array.prototype.slice.call(m.querySelectorAll('.pm-row'));
  let i = rows.indexOf(document.activeElement);
  if (i < 0) i = 0;
  armMenuIdle();
  if (k === 'left' || k === 'back') { closePlayerMenu(); return; }
  if (k === 'up') { rows[Math.max(0, i - 1)].focus(); return; }
  if (k === 'down') { rows[Math.min(rows.length - 1, i + 1)].focus(); return; }
  if (k === 'right' && !rows[i].classList.contains('pm-cycle')) return;
  menuAct(rows[i]);
}

/* Values apply live through Player.applyAll(); playback is never rebuilt. */
function menuAct(row) {
  const act = row && row.getAttribute('data-act');
  const live = function () {
    if (typeof Player !== 'undefined' && Player.applyAll) Player.applyAll();
    renderPlayerMenu();
    updateChrome();
  };
  if (act === 'next') {
    closePlayerMenu();
    playNext();
  } else if (act === 'prev') {
    closePlayerMenu();
    playPrev();
  } else if (act === 'restart') {
    closePlayerMenu();
    restartVideo();
  } else if (act === 'speed' && prefs) {
    prefs.cycleSpeed();
    live();
  } else if (act === 'sound' && sound) {
    sound.setEnabled(!sound.enabled());
    live();
  } else if (act === 'picture' && prefs) {
    prefs.setAudioOnly(!prefs.audioOnly());
    live();
  } else if (act === 'sleep' && prefs) {
    prefs.cycleSleep();
    armSleep();
    live();
  }
}

function openRecents() {
  const list = recentsLoad();
  navTo({
    name: 'list', kind: 'recents', videos: list,
    render: function () {
      if (!list.length) {
        renderList('Recents', [], 'Nothing played yet. Send a link from your iPhone, or pick a channel.',
          'recents', { label: 'Open Channels', onPick: () => openChannels() });
        return;
      }
      showVideoList('Recents', list, 'recents');
    },
  });
}

/* A saved playlist opens its contents (Play all plus the rows), the same as a
   channel does, instead of starting to play on the pinch. */
function openPlaylists() {
  const lists = playlistsLoad();
  navTo({
    name: 'list', kind: 'playlists',
    render: function () {
      renderList('Playlists', lists.map(p => ({
        key: 'pl:' + p.name,
        count: true,
        label: p.name,
        sub: (p.videos || []).length + ' videos',
        onPick: () => navVideoList(p.name, p.videos || [], 'playlist'),
      })), 'Send a playlist from your iPhone. It stays here after that.', 'playlists',
      { label: 'Pair your iPhone', sub: 'Then send a playlist from the app', onPick: () => openPhone() });
    },
  });
}

/* Channel pages replace the current entry: Back from page 2 goes where the
   wearer was before Channels, not to page 1. */
function openChannels(page, replace) {
  const p = Math.max(0, Number(page) || 0);
  navTo({ name: 'list', kind: 'channels', render: function () { renderChannels(p); } },
    { replace: !!replace });
}

function renderChannels(page) {
  channelPage = Math.max(0, Number(page) || 0);
  const all = channelsLoad();
  const start = channelPage * CHANNEL_PAGE;
  const slice = all.slice(start, start + CHANNEL_PAGE);
  const items = slice.map(ch => ({
    key: ch.id,
    count: true,
    label: ch.name,
    onPick: () => loadChannel(ch),
  }));
  if (start + CHANNEL_PAGE < all.length) {
    items.push({
      key: 'more-channels',
      label: 'More channels',
      sub: (all.length - start - CHANNEL_PAGE) + ' more',
      onPick: () => openChannels(channelPage + 1, true),
    });
  } else if (channelPage > 0) {
    items.push({
      key: 'first-page',
      label: 'First page',
      sub: all.length + ' channels',
      onPick: () => openChannels(0, true),
    });
  }
  renderList('Channels', items, 'Add channels on your iPhone. They show up here.', 'channels');
}

/* The picked row spins while the feed loads; the video list opens only if
   the wearer is still where they picked it (navGen unchanged). */
function loadChannel(ch) {
  if (feedWait === ch.id) return;
  feedWait = ch.id;
  const gen = navGen;
  const row = rowLoading(ch.id);
  if (!row) setStatus('Loading ' + ch.name + '...');
  function stale() { return feedWait !== ch.id || gen !== navGen; }
  function attempt() {
    if (stale()) return;
    fetch('/api/feed?channel=' + encodeURIComponent(ch.id))
      .then(r => r.json())
      .then(d => {
        if (stale()) return;
        if (!d.ok) {
          feedHealth = d.error || 'feed failed';
          if (isNetErr(d.error)) {
            setOffline(true);
            setTimeout(attempt, RETRY_MS);
            return;
          }
          feedWait = '';
          rowLoaded(row);
          setStatus(d.error || 'Could not load that channel.', true);
          return;
        }
        setOffline(false);
        feedHealth = 'ok · ' + (d.videos || []).length + ' videos';
        const videos = (d.videos || []).map(v => ({
          id: v.id,
          title: v.title,
          channel: v.channel || ch.name,
          thumb: v.thumb,
          duration: v.duration || '',
        }));
        navVideoList(ch.name, videos, 'channel');
      })
      .catch(e => {
        if (stale()) return;
        feedHealth = String((e && e.message) || e);
        setOffline(true);
        setTimeout(attempt, RETRY_MS);
      });
  }
  attempt();
}

/* ---- Search ------------------------------------------------------------

   The glasses have no keyboard. The Neural Band gives four directions and a
   pinch, so the screen is a stack of cursor rows the band walks:
     row -2   the native search field. A pinch on it opens the system composer
              (dictation, handwriting, keyboard) on firmware v127 and later.
     row -1   chips: the 4 most recent searches, or up to 4 suggestions once
              two letters are typed. Re-running a search is pinch, Up, pinch.
     rows 0-3 a 10-wide letter grid, the fallback when there is no composer.
     row 4    actions: Search | Delete | Clear | Back.
   The cursor is a class (.kb-on), not DOM focus, except on the field, which
   needs real focus for the composer. Up and Down never wrap; Left and Right
   wrap within a row. Left with an empty field at the left edge goes back. */

const KEY_ROWS = [
  'ABCDEFGHIJ'.split(''),
  'KLMNOPQRST'.split(''),
  'UVWXYZ0123'.split(''),
  '456789'.split('').concat([' ']),
];
const KEY_ACTIONS = [
  { label: 'Search', act: 'go', wide: true, primary: true },
  { label: 'Delete', act: 'del', wide: true },
  { label: 'Clear', act: 'clear', wide: true },
  { label: 'Back', act: 'back', wide: true },
];
const KB_INPUT_ROW = -2;
const KB_CHIP_ROW = -1;
const KB_MAX = 60;
const SUGGEST_DEBOUNCE_MS = 300;
const SUGGEST_TIMEOUT_MS = 3000;

let typed = '';
let keyRow = 0;
let keyCol = 0;
// Where the cursor sits across the row (0-1). Rows have 10, 7 and 4 keys, so
// moving between them by position, and remembering it, makes Down then Up
// come back to the same key.
let keyX = 0.05;
let chipIdx = 0;
let kbKeys = null;
let kbChipsShown = '';
let kbBlurring = false;
let suggestFor = '';
let suggestList = [];
let suggestTimer = 0;
let suggestCtl = null;

function keyGrid() {
  return KEY_ROWS.concat([KEY_ACTIONS.map(a => a.label)]);
}

function kbInput() {
  return $('#kb-input');
}

/* The composer cannot type ' " _ [ ] and the search does not need them. */
function cleanQuery(s) {
  return String(s || '').replace(/['"_[\]]/g, '').toUpperCase().slice(0, KB_MAX);
}

/* Suggestions replace the recents once two letters are typed and an answer
   for this prefix is in. Anything else (no answer yet, offline, refused)
   shows recents, so a failure is silent. */
function searchChips() {
  const q = typed.trim().toLowerCase();
  if (q.length >= 2 && suggestList.length && suggestFor && q.indexOf(suggestFor) === 0) {
    return { kind: 'suggest', items: suggestList.slice(0, 4) };
  }
  return { kind: 'recent', items: queriesLoad().slice(0, 4) };
}

/* The keys never change, so build them once and only move the .kb-on class
   afterwards: a full rebuild per swipe is wasted work on the glasses' CPU. */
function buildSearchGrid() {
  const box = $('#kb-grid');
  if (!box) return null;
  box.innerHTML = '';
  const grid = keyGrid();
  return grid.map((row, r) => {
    const line = document.createElement('div');
    line.className = 'kb-row' + (r === grid.length - 1 ? ' kb-actions' : '');
    const keys = row.map((cell, c) => {
      const b = document.createElement('button');
      const action = r === grid.length - 1 ? KEY_ACTIONS[c] : null;
      b.className = 'kb-key' +
        (action && action.primary ? ' kb-go' : '') +
        (action ? ' kb-wide' : '');
      b.tabIndex = -1;
      b.textContent = cell === ' ' ? 'Space' : cell;
      if (cell === ' ') b.classList.add('kb-space');
      b.addEventListener('click', () => {
        kbSetRow(r);
        keyCol = c;
        keyX = (c + 0.5) / row.length;
        pressKey();
      });
      line.appendChild(b);
      return b;
    });
    box.appendChild(line);
    return keys;
  });
}

/* A suggestion repeats what is already typed; once that is long, show it
   from the last typed word so the part that differs is what fits. */
function chipLabel(text, kind) {
  const q = typed.toLowerCase();
  if (kind !== 'suggest' || q.length < 12 || text.toLowerCase().indexOf(q) !== 0) return text;
  const cut = q.lastIndexOf(' ') + 1;
  return cut > 0 ? '…' + text.slice(cut) : text;
}

function renderSearchChips(chips) {
  const box = $('#kb-chips');
  if (!box) return;
  const labels = chips.items.map(t => chipLabel(t, chips.kind));
  const sig = chips.kind + '\n' + chips.items.join('\n') + '\n' + labels.join('\n');
  if (sig !== kbChipsShown) {
    kbChipsShown = sig;
    box.innerHTML = '';
    chips.items.forEach((text, i) => {
      const b = document.createElement('button');
      b.className = 'kb-chip';
      b.tabIndex = -1;
      b.textContent = labels[i];
      b.addEventListener('click', () => { typed = text; runSearch(); });
      box.appendChild(b);
    });
  }
  box.classList.toggle('kb-suggest', chips.kind === 'suggest');
  if (chipIdx > chips.items.length - 1) chipIdx = Math.max(0, chips.items.length - 1);
  const onChips = keyRow === KB_CHIP_ROW;
  Array.prototype.forEach.call(box.children, (b, i) => b.classList.toggle('kb-on', onChips && i === chipIdx));
  // One row, scrolled sideways so the chip under the cursor is always whole
  // and clear of the 32px fades that say more chips sit past an edge.
  const on = onChips ? box.children[chipIdx] : null;
  if (!on) box.scrollLeft = 0;
  else if (on.offsetLeft < box.scrollLeft + 36) box.scrollLeft = Math.max(0, on.offsetLeft - 36);
  else if (on.offsetLeft + on.offsetWidth > box.scrollLeft + box.clientWidth - 36) {
    box.scrollLeft = on.offsetLeft + on.offsetWidth - box.clientWidth + 36;
  }
  box.classList.toggle('kb-fade-l', box.scrollLeft > 0);
  box.classList.toggle('kb-fade-r', box.scrollLeft + box.clientWidth < box.scrollWidth - 1);
}

function renderSearch() {
  if (!kbKeys || !kbKeys[0][0].isConnected) kbKeys = buildSearchGrid();
  if (!kbKeys) return;
  const chips = searchChips();
  if (keyRow === KB_CHIP_ROW && !chips.items.length) kbSetRow(0);
  kbKeys.forEach((row, r) => row.forEach((b, c) => {
    b.classList.toggle('kb-on', r === keyRow && c === keyCol);
  }));
  const input = kbInput();
  if (input) {
    if (cleanQuery(input.value) !== cleanQuery(typed)) input.value = typed;
    // Show the end of the query, the part just typed, not the start, and
    // fade the cut-off start instead of slicing a letter in half.
    if (document.activeElement !== input) input.scrollLeft = input.scrollWidth;
    input.classList.toggle('kb-long', input.scrollWidth > input.clientWidth + 1);
  }
  const field = $('#kb-field');
  if (field) field.classList.toggle('kb-on', keyRow === KB_INPUT_ROW);
  renderSearchChips(chips);
  const hint = $('#kb-hint');
  if (hint) {
    hint.classList.toggle('hidden',
      !(chips.kind === 'suggest' && typed.trim().length >= 3 && keyRow >= 0));
  }
}

function kbFocusInput() {
  const input = kbInput();
  if (!input) return;
  try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  const n = input.value.length;
  try { input.setSelectionRange(n, n); } catch (e) { /* not supported */ }
}

/* Our own blur must not count as the composer committing text: Chrome fires
   'change' on blur when the value changed while focused. */
function kbBlurInput() {
  const input = kbInput();
  if (!input || document.activeElement !== input) return;
  kbBlurring = true;
  try { input.blur(); } finally { kbBlurring = false; }
}

function kbSetRow(r) {
  const was = keyRow;
  keyRow = r;
  if (r === KB_CHIP_ROW) chipIdx = 0;
  if (r >= 0) {
    const n = keyGrid()[r].length;
    keyCol = Math.max(0, Math.min(n - 1, Math.floor(keyX * n)));
  }
  if (r === KB_INPUT_ROW) kbFocusInput();
  else if (was === KB_INPUT_ROW) kbBlurInput();
}

function moveKey(dr, dc) {
  const grid = keyGrid();
  if (dr) {
    let r = keyRow + dr;
    if (r === KB_CHIP_ROW && !searchChips().items.length) r += dr;
    // No vertical wrap: Up from the field and Down from the actions stay put,
    // so a stray swipe never lands on Back and throws the query away.
    if (r < KB_INPUT_ROW || r > grid.length - 1) return;
    kbSetRow(r);
    renderSearch();
    return;
  }
  if (keyRow === KB_INPUT_ROW) return;
  if (keyRow === KB_CHIP_ROW) {
    const n = searchChips().items.length;
    if (!n) return;
    chipIdx = (chipIdx + dc + n) % n;
    renderSearch();
    return;
  }
  const row = grid[keyRow];
  keyCol = (keyCol + dc + row.length) % row.length;
  keyX = (keyCol + 0.5) / row.length;
  renderSearch();
}

/* Left is the app-wide back gesture. Here it only goes back from the left
   edge (field, first chip, or A) with nothing typed; anywhere else it moves
   the cursor, so it can never throw a query away. */
function searchLeftIsBack() {
  if (typed) return false;
  if (keyRow === KB_INPUT_ROW) return true;
  if (keyRow === KB_CHIP_ROW) return chipIdx === 0;
  return keyRow === 0 && keyCol === 0;
}

function leaveSearch() {
  kbBlurInput();
  suggestCancel();
  goBack();
}

function searchTyped() {
  suggestSchedule();
  renderSearch();
}

function pressKey() {
  if (keyRow === KB_INPUT_ROW) {
    if (typed.trim()) runSearch();
    else kbFocusInput();
    return;
  }
  if (keyRow === KB_CHIP_ROW) {
    const pick = searchChips().items[chipIdx];
    if (pick) { typed = pick; runSearch(); }
    return;
  }
  const grid = keyGrid();
  if (keyRow === grid.length - 1) {
    const action = KEY_ACTIONS[keyCol];
    if (!action) return;
    if (action.act === 'back') { leaveSearch(); return; }
    if (action.act === 'go') { runSearch(); return; }
    if (action.act === 'del') typed = typed.slice(0, -1);
    if (action.act === 'clear') typed = '';
    searchTyped();
    return;
  }
  if (typed.length < KB_MAX) typed += grid[keyRow][keyCol];
  searchTyped();
}

/* Text from the field: the composer (dictation, handwriting, on-screen
   keyboard) or a real keyboard. Mid-composition the value is left alone so
   the IME is not disturbed; stripped characters are removed once it ends. */
function searchFromInput(e) {
  const input = kbInput();
  if (!input || current !== 'search') return;
  const next = cleanQuery(input.value);
  if (!(e && e.isComposing) && next !== input.value.toUpperCase().slice(0, KB_MAX)) {
    input.value = next;
  }
  if (document.activeElement === input && keyRow !== KB_INPUT_ROW) keyRow = KB_INPUT_ROW;
  if (next !== typed) {
    typed = next;
    suggestSchedule();
  }
  renderSearch();
}

function suggestCancel() {
  clearTimeout(suggestTimer);
  suggestTimer = 0;
  if (suggestCtl) {
    try { suggestCtl.abort(); } catch (e) { /* already done */ }
    suggestCtl = null;
  }
}

function suggestSchedule() {
  const q = typed.trim().toLowerCase();
  suggestCancel();
  if (q.length < 2 || q === suggestFor) return;
  suggestTimer = setTimeout(function () { suggestFetch(q); }, SUGGEST_DEBOUNCE_MS);
}

function suggestFetch(q) {
  suggestTimer = 0;
  if (current !== 'search') return;
  // navGen is the ghost-load guard (WP3): an answer for a screen the wearer
  // has navigated away from, or a prefix they typed past, is dropped.
  const gen = navGen;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  suggestCtl = ctl;
  const killer = setTimeout(function () { if (ctl) ctl.abort(); }, SUGGEST_TIMEOUT_MS);
  const stale = () => navGen !== gen ||
    current !== 'search' || typed.trim().toLowerCase() !== q;
  fetch('/api/suggest?q=' + encodeURIComponent(q), ctl ? { signal: ctl.signal } : undefined)
    .then(r => r.json())
    .then(d => {
      if (stale()) return;
      suggestFor = q;
      suggestList = d && d.ok && Array.isArray(d.suggestions)
        ? d.suggestions.filter(s => typeof s === 'string' && s.trim())
          .map(s => s.trim().slice(0, 80)).slice(0, 4)
        : [];
      renderSearch();
    })
    .catch(function () {
      // Timed out or offline: fall back to recents, silently. A newer
      // keystroke cancelling this request is not a failure.
      if (suggestCtl !== ctl || stale()) return;
      suggestFor = q;
      suggestList = [];
      renderSearch();
    })
    .then(function () {
      clearTimeout(killer);
      if (suggestCtl === ctl) suggestCtl = null;
    });
}

/* Opening Search from Home pushes a new nav entry and starts empty. Coming
   back to it from results is a nav-stack pop, which redraws the same entry:
   that keeps the query and parks the cursor on the Search key. */
function openSearch() {
  navTo({
    name: 'search',
    render: function (entry) {
      const keep = !!entry.shown;
      entry.shown = true;
      searchScreen(keep);
    },
  });
}

function searchScreen(keep) {
  kbBlurInput();
  suggestCancel();
  if (keep) {
    keyRow = keyGrid().length - 1;
    keyCol = 0;
    keyX = 0.05;
  } else {
    typed = '';
    suggestFor = '';
    suggestList = [];
    keyRow = 0;
    keyCol = 0;
    keyX = 0.05;
  }
  chipIdx = 0;
  const input = kbInput();
  if (input && !keep) input.value = '';
  show('search');
  // Only the grid cursor is lit: nothing on this screen holds DOM focus.
  if (document.activeElement && document.activeElement !== document.body &&
      document.activeElement.blur) document.activeElement.blur();
  renderSearch();
  if (keep) suggestSchedule();
}

/* Results open as their own entry right away ('Searching...'), and fill in
   only if the wearer has not navigated since (navGen). */
function runSearch() {
  const q = typed.trim();
  if (!q) return;
  kbBlurInput();
  suggestCancel();
  lastQuery = q;
  queriesAdd(q);
  const entry = {
    name: 'list', kind: 'search', videos: null, empty: 'Searching...',
    render: function () {
      if (entry.videos && entry.videos.length) showVideoList('Search: ' + q, entry.videos, 'search');
      else renderList(entry.videos ? 'Search: ' + q : 'Search', [], entry.empty, 'search');
    },
  };
  navTo(entry);
  const gen = navGen;
  fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=20')
    .then(r => r.json())
    .then(d => {
      if (gen !== navGen) return;
      setStatus('');
      if (d.ok && (d.videos || []).length) setOffline(false);
      entry.videos = d.ok ? (d.videos || []) : [];
      entry.empty = d.error || 'Nothing found for that.';
      navRender(entry, false);
    })
    .catch(e => {
      if (gen !== navGen) return;
      setOffline(true);
      entry.videos = [];
      entry.empty = netText(e);
      navRender(entry, false);
    });
}

/* ---- Library (needs the phone's Google session) ------------------------- */

/* Send the session as a header rather than a query string wherever the
   request is a plain fetch, so the token stays out of access logs. The <video>
   element cannot set headers, which is why /api/watch still takes ?s=.
   The server rotates an expiring token back in a header; keep it or the
   glasses quietly fall out of the library a week later. */
function authFetch(url) {
  return fetch(url, { headers: { Authorization: 'Bearer ' + ytSession } })
    .then(r => {
      const rotated = r.headers.get('X-GlassTube-Session');
      if (rotated) sessionStore(rotated);
      return r.json();
    });
}

function libraryFetch() {
  return authFetch('/api/yt/library')
    .then(d => {
      if (!d.ok) throw new Error(d.error || 'Sign in on the phone again.');
      library = d;
      libraryErr = '';
      return d;
    });
}

/* Library is one nav entry that redraws itself as the fetch lands, but only
   while the wearer is still on it (navGen). A failure offers 'Try again'. */
function openLibrary() {
  const entry = {
    name: 'list', kind: 'library',
    render: function () {
      if (!ytSession) {
        renderList('Library', [],
          'Tap "Send sign-in to glasses" in the iPhone app first.', 'library');
        return;
      }
      if (library) { renderLibrary(); return; }
      if (libraryErr) {
        renderList('Library', [], libraryErr, 'library', {
          label: 'Try again',
          onPick: () => { libraryErr = ''; libraryLoad(entry); },
        });
        return;
      }
      renderList('Library', [], 'Loading your YouTube...', 'library');
    },
  };
  libraryErr = '';
  navTo(entry);
  if (ytSession && !library) libraryLoad(entry);
}

function libraryLoad(entry) {
  const gen = navGen;
  if (current === 'list' && navTop() === entry) navRender(entry, false);
  libraryFetch().then(function () {
    if (gen === navGen) navRender(entry, false);
  }).catch(e => {
    libraryErr = String((e && e.message) || e);
    if (gen === navGen) navRender(entry, false);
  });
}

function renderLibrary() {
  const d = library || {};
  const items = [];
  if ((d.watchLater || []).length) {
    items.push({
      key: 'lib:wl',
      count: true,
      label: 'Watch later',
      sub: d.watchLater.length + ' videos',
      onPick: () => navVideoList('Watch later', d.watchLater, 'libvideos'),
    });
  }
  if ((d.likes || []).length) {
    items.push({
      key: 'lib:likes',
      count: true,
      label: 'Liked videos',
      sub: d.likes.length + ' videos',
      onPick: () => navVideoList('Liked videos', d.likes, 'libvideos'),
    });
  }
  (d.playlists || []).slice(0, 20).forEach(p => {
    items.push({
      key: 'lib:' + p.id,
      count: true,
      label: p.name,
      sub: p.count + ' videos',
      onPick: () => openLibraryPlaylist(p),
    });
  });
  if ((d.subscriptions || []).length) {
    items.push({
      key: 'lib:subs',
      count: true,
      label: 'Subscriptions',
      sub: d.subscriptions.length + ' channels',
      onPick: () => openSubs(),
    });
  }
  renderList('Library', items,
    libraryErr || 'Nothing in your YouTube library yet.', 'library');
}

function openLibraryPlaylist(p) {
  const entry = {
    name: 'list', kind: 'libplaylist', videos: null, empty: 'Loading...',
    render: function () {
      if (entry.videos && entry.videos.length) showVideoList(p.name, entry.videos, 'libplaylist');
      else renderList(p.name, [], entry.empty, 'libplaylist');
    },
  };
  navTo(entry);
  const gen = navGen;
  authFetch('/api/yt/playlist?id=' + encodeURIComponent(p.id))
    .then(d => {
      if (gen !== navGen) return;
      entry.videos = d.ok ? (d.videos || []) : [];
      entry.empty = d.error || 'That playlist is empty.';
      navRender(entry, false);
    })
    .catch(e => {
      if (gen !== navGen) return;
      entry.videos = [];
      entry.empty = netText(e);
      navRender(entry, false);
    });
}

function openSubs() {
  const subs = (library && library.subscriptions) || [];
  navTo({
    name: 'list', kind: 'subs',
    render: function () {
      renderList('Subscriptions', subs.map(ch => ({
        key: ch.id,
        count: true,
        label: ch.name,
        thumb: ch.thumb || '',
        onPick: () => loadChannel({ id: ch.id, name: ch.name }),
      })), 'No subscriptions found.', 'subs');
    },
  });
}

function openPhone() {
  navTo({ name: 'phone', render: function () { show('phone'); } });
  pairCode = pairCodeStored();
  pairLink = linkStored();
  if (pairKey()) {
    renderPhone();
    startPairPoll();
    // No default focus here (WP3 focusDefault): a stray pinch on arrival
    // never lands on 'Link a different phone'.
  } else {
    newPairCode();
  }
}

/* WP4: linked, the screen says so and keeps the code small; not linked, it
   shows the big code and the three steps. */
function renderPhone() {
  const linked = pairLinked();
  $('#pair-linked').classList.toggle('hidden', !linked);
  $('#pair-code').classList.toggle('hidden', linked);
  $('#pair-steps').classList.toggle('hidden', linked);
  if (linked) {
    $('#pair-last').textContent = lastPushInfo
      ? lastPushText()
      : 'Send a video from the iPhone app. It plays here on any screen.';
    $('#pair-linked-code').textContent = pairCode ? 'Code ' + pairCode : '';
    $('#pair-help').textContent = '';
  } else {
    $('#pair-code').textContent = pairCode || (pairKey() ? '······' : '------');
    $('#pair-help').textContent = pairKey() ? 'Waiting for your iPhone…' : 'Getting a code…';
  }
}

function newPairCode() {
  if (pairMintTimer) {
    clearTimeout(pairMintTimer);
    pairMintTimer = 0;
  }
  pairPairedSet(false);
  if (current === 'phone') renderPhone();
  $('#pair-code').textContent = '------';
  $('#pair-help').textContent = netOffline ? offlineText() : 'Getting a code…';
  // WP6: after an unlink, tell the server which link this code replaces, so
  // the old phone hears it is no longer linked instead of pushing into a void.
  const mint = pairReplaces
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replaces: pairReplaces }) }
    : { method: 'POST' };
  fetch('/api/pair', mint)
    .then(r => r.json())
    .then(d => {
      if (d.ok && d.code) pairReplaces = '';
      if (!d.ok || !d.code) {
        pairState = d.error || 'pair failed';
        if (isNetErr(d.error)) {
          netFail();
          $('#pair-help').textContent = offlineText();
          pairMintTimer = setTimeout(newPairCode, RETRY_MS);
          return;
        }
        $('#pair-help').textContent = d.error || 'Could not get a code. Check Diagnostics.';
        return;
      }
      netOk();
      pairCode = d.code;
      pairCodeStore(pairCode);
      linkStore(d.token || '');
      pairState = 'code ' + pairCode;
      $('#pair-code').textContent = pairCode;
      $('#pair-help').textContent = 'Waiting for your iPhone…';
      updateHomePhoneHint();
      startPairPoll();
    })
    .catch(e => {
      pairState = netText(e).slice(0, 40);
      netFail();
      $('#pair-help').textContent = offlineText();
      pairMintTimer = setTimeout(newPairCode, RETRY_MS);
    });
}

/* The poll loop is a setTimeout chain, not an interval: pollPair schedules
   the next request only when the current one has finished, so at most one is
   ever in flight. It runs whenever there is a key, link token or code. */
function startPairPoll() {
  stopPairPoll();
  if (!pairKey()) return;
  pollPair();
}

function stopPairPoll() {
  if (pairTimer) clearTimeout(pairTimer);
  pairTimer = null;
  pollDueAt = 0;
}

/* Glasses or the phone's own HUD preview, for the server log and delivery. */
function pollWho() {
  const hook = !!(window.webkit && window.webkit.messageHandlers &&
    window.webkit.messageHandlers.glasstube);
  return (hook || /iPhone|iPad/i.test(navigator.userAgent)) ? 'preview' : 'hud';
}

function pollDelay() {
  if (document.hidden) return POLL_HIDDEN_MS;
  if (current === 'phone' || Date.now() - lastActiveAt < ACTIVE_WINDOW_MS) return POLL_ACTIVE_MS;
  return POLL_IDLE_MS;
}

/* After a network or HTTP failure: 2s, 4s, 8s, then 15s, never faster than
   the cadence the wearer's state already asks for. */
function nextPollDelay() {
  if (!pollFails) return pollDelay();
  const back = POLL_BACKOFF_MS[Math.min(pollFails, POLL_BACKOFF_MS.length) - 1];
  return Math.max(pollDelay(), back);
}

function schedulePoll(ms) {
  if (pairTimer) clearTimeout(pairTimer);
  pairTimer = null;
  pollDueAt = 0;
  if (!pairKey()) return;
  const wait = Math.max(0, ms == null ? nextPollDelay() : ms);
  pollDueAt = Date.now() + wait;
  pairTimer = setTimeout(function () {
    pairTimer = null;
    pollDueAt = 0;
    pollPair();
  }, wait);
}

/* Poll as soon as possible. Resume events (visible, pageshow, focus, online)
   tend to arrive together; the short delay folds them into one request, and a
   request that started under a second ago already counts. */
function pollNow() {
  if (!pairKey()) return;
  if (pollBusy) {
    if (Date.now() - pollStartedAt > POLL_FRESH_MS) pollAgain = true;
    return;
  }
  if (pairTimer && pollDueAt - Date.now() <= POLL_NOW_MS) return;
  schedulePoll(POLL_NOW_MS);
}

/* The wearer just did something: a long idle wait shrinks to the active
   cadence instead of running out first. */
function pollSoonerIfIdle() {
  if (pollBusy || !pairKey()) return;
  const want = nextPollDelay();
  if (!pairTimer || pollDueAt - Date.now() > want) schedulePoll(want);
}

/* Every 10s: if no poll has started for 30s while visible, the chain broke
   somewhere. Abort a request stuck past its own timeout and start again. */
function pollWatchdog() {
  if (document.hidden || !pairKey()) return;
  const since = Date.now() - pollStartedAt;
  if (pollBusy) {
    if (since > POLL_TIMEOUT_MS + 5000) {
      if (pollCtrl) pollCtrl.abort();
      else { pollBusy = false; schedulePoll(0); }
    }
    return;
  }
  if (since > WATCHDOG_STALL_MS) {
    hudNote('poll-restart', { since: Math.round(since / 1000) });
    schedulePoll(0);
  }
}

/* What the HUD did with a push, posted to the server log next to the phone's
   own resolve report. The glasses have no console anyone can read, and "it
   says playing but nothing happens" is otherwise invisible from both ends. */
function hudNote(ev, extra) {
  try {
    const body = Object.assign({
      kind: 'hud', ev: ev, screen: current, vis: document.visibilityState,
      id: nowPlaying && nowPlaying.id, route: wayChain && wayChain[wayPos],
    }, extra || {});
    fetch('/api/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(function () {});
  } catch (e) { /* diagnostics only */ }
}

/* WP6: server-confirmed delivery. The glasses tell the server what happened to
   the push they are tracking, and /api/push waits for it, so the phone says
   'Playing on your glasses' only when they are. One push is tracked at a time:
   the newest one. Each state goes out at most once, in order, and nothing is
   sent after a terminal state. 'got' replaces the plain ack and, like 'missed',
   consumes the push on the server. handlePush decides which one to send. */
const DELIVERY_TERMINAL = { playing: 1, failed: 1, missed: 1 };
let deliveryPush = null;
let deliveryChain = Promise.resolve();

function deliveryTrack(seq) {
  deliveryPush = { seq: seq, id: '', sent: {}, done: false };
}

/* Which video of the tracked push is on screen: the first one opened after it
   arrived, or the next one a queue skips to before anything played. */
function deliveryVideo(id) {
  if (!deliveryPush || deliveryPush.done || !id) return;
  if (!deliveryPush.id || !deliveryPush.sent.playing) deliveryPush.id = id;
}

function deliveryFor(id) {
  return !!(deliveryPush && !deliveryPush.done && deliveryPush.id && deliveryPush.id === id);
}

function deliveryReport(state, detail) {
  const p = deliveryPush;
  const code = pairKey();
  if (!p || p.done || p.sent[state] || !code) return;
  p.sent[state] = true;
  if (DELIVERY_TERMINAL[state]) p.done = true;
  const body = JSON.stringify({
    code: code, ack: p.seq, state: state,
    detail: detail ? String(detail).slice(0, 300) : '',
    b: String(window.GLASSTUBE_BUILD || ''), who: pollWho(),
  });
  deliveryChain = deliveryChain.then(function () {
    return fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    }).catch(function () { /* the server falls back to its own timeout */ });
  });
}

/* The one place a poll response is handled. Single flight: a call while a
   request is out only asks for another one right after it. */
function pollPair() {
  const key = pairKey();
  if (!key) return;
  if (pollBusy) { pollAgain = true; return; }
  if (pairTimer) clearTimeout(pairTimer);
  pairTimer = null;
  pollDueAt = 0;
  pairKeyChanged();
  pollBusy = true;
  pollAgain = false;
  pollStartedAt = Date.now();
  const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
  pollCtrl = ctrl;
  const timeout = setTimeout(function () { if (ctrl) ctrl.abort(); }, POLL_TIMEOUT_MS);
  const url = '/api/pair?code=' + encodeURIComponent(key) +
    '&b=' + encodeURIComponent(window.GLASSTUBE_BUILD || '') +
    '&i=' + instanceId + '&who=' + pollWho() +
    '&vis=' + (document.hidden ? 'hidden' : 'visible');
  let answered = false;
  fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(d => {
      answered = true;
      // The key changed while this was out (unlink, new code): not ours.
      if (key !== pairKey()) return;
      d = d || {};
      if (!d.ok) {
        const dead = d.gone === true || /expir|not active|not found|unknown/i.test(d.error || '');
        // A server that answers 'gone' is reachable, so not 'offline'.
        if (dead) netOk();
        else netFail();
        // One dead answer is not proof: a server or database blip says the
        // same. Wipe the link only after GONE_STRIKES answers over GONE_SPAN_MS.
        if (dead) {
          if (!goneStrikes) goneFirstAt = Date.now();
          goneStrikes += 1;
        }
        const wipe = dead && goneStrikes >= GONE_STRIKES && Date.now() - goneFirstAt >= GONE_SPAN_MS;
        pairState = wipe ? 'code expired'
          : dead ? 'link not found · check ' + Math.min(goneStrikes, GONE_STRIKES) + '/' + GONE_STRIKES
          : (d.error || 'pair failed');
        lastPoll = { at: Date.now(), ok: false, text: pairState };
        if (current === 'phone') {
          $('#pair-help').textContent = wipe
            ? 'That code expired. Getting a new one...'
            : dead ? 'Checking your link…' : (d.error || 'Could not reach pairing.');
        }
        if (!wipe) return;
        hudNote('pair-gone', { strikes: goneStrikes, error: String(d.error || '').slice(0, 80) });
        goneStrikes = 0;
        goneFirstAt = 0;
        stopPairPoll();
        pairIgnoreUrl();
        pairPairedSet(false);
        pairCodeStore('');
        linkStore('');
        pairCode = '';
        updateHomePhoneHint();
        ensureListening();
        return;
      }
      goneStrikes = 0;
      goneFirstAt = 0;
      lastPoll = { at: Date.now(), ok: true, text: d.paired ? 'ok · paired' : 'ok · waiting' };
      noteServerBuild(d.build);
      netOk();
      if (d.token && d.token !== pairLink) linkStore(d.token);
      if (d.code && d.code !== pairCode) {
        pairCode = d.code;
        pairCodeStore(pairCode);
      }
      pairPairedSet(d.paired === true);
      pairState = (d.paired ? 'paired' : 'waiting') + ' · ' + pairCode;
      renderHome();
      if (d.paired === true) pairTouchMaybe();
      if (current === 'phone') renderPhone();
      const dest = d.dest;
      const playable = dest && (dest.id || (dest.videos && dest.videos[0]));
      const special = dest && (dest.kind === 'channels' || dest.kind === 'channel' ||
        dest.kind === 'session');
      if (dest && (playable || special) && d.destSeq !== pairLastSeq) {
        pairLastSeq = d.destSeq;
        // WP6: track this push; handlePush sends 'got' (or 'missed' for a
        // stale one), which replaces the plain ack and consumes the push.
        deliveryTrack(d.destSeq);
        // Stale, hidden and fresh pushes each go their own way: handlePush.
        handlePush(dest, d.destSeq, !!special);
      }
    })
    .catch(e => {
      // A bug while handling a good answer is not the network going away.
      if (answered) { report('JS error: poll · ' + String((e && e.message) || e).slice(0, 120)); return; }
      if (key !== pairKey()) return;
      const timedOut = e && e.name === 'AbortError';
      pairState = (timedOut ? 'no answer in ' + (POLL_TIMEOUT_MS / 1000) + 's' : netText(e)).slice(0, 48);
      lastPoll = { at: Date.now(), ok: false, text: pairState };
      netFail();
    })
    .then(function () {
      clearTimeout(timeout);
      if (pollCtrl === ctrl) pollCtrl = null;
      pollBusy = false;
      if (!pairKey()) return;
      if (maybeUpdate()) return;
      schedulePoll(pollAgain ? POLL_NOW_MS : nextPollDelay());
      pollAgain = false;
    });
}

/* Self-update (WP1). The glasses keep this page alive for days, so a deploy
   only lands if the page notices it is out of date. Every /api/pair answer
   carries the deployed build (scripts/stamp.mjs); when it differs from ours,
   reload at the next safe moment: idle on Home, or the moment the wearer
   comes back to the app. Never in the player, never with search text typed,
   never right after a push, and at most once per build (URL rv marker plus
   localStorage reloadedFor), so a bad deploy cannot become a reload loop. */
function urlRv() {
  try { return new URL(location.href).searchParams.get('rv') || ''; }
  catch (e) { return ''; }
}

function reloadedRecently(build) {
  try {
    const r = JSON.parse(localStorage.getItem(RELOADED_FOR_KEY) || 'null');
    return !!(r && r.build === build && Date.now() - Number(r.at || 0) < UPDATE_RETRY_MS);
  } catch (e) { return false; }
}

function updateAllowed() {
  return !!updatePending && urlRv() !== updatePending && !reloadedRecently(updatePending);
}

function noteServerBuild(build) {
  if (!build) return;
  serverBuild = String(build);
  if (serverBuild === String(window.GLASSTUBE_BUILD || '')) { updatePending = ''; return; }
  if (updatePending === serverBuild) return;
  updatePending = serverBuild;
  // Already reloaded for this build and still behind: the reload did not take.
  hudNote(updateAllowed() ? 'update-pending' : 'update-stuck',
    { from: window.GLASSTUBE_BUILD || '', to: serverBuild });
}

function searchTextTyped() {
  if (typeof typed === 'string' && typed.trim()) return true;
  const field = document.querySelector('#screen-search input');
  return !!(field && String(field.value || '').trim());
}

function pushIsFresh() {
  if (lastPushAt && Date.now() - lastPushAt < UPDATE_PUSH_QUIET_MS) return true;
  // A push held while hidden (WP4) plays before any reload.
  return !!pendingPush;
}

/* Idle path: after each poll and every UPDATE_CHECK_MS. */
function maybeUpdate() {
  if (!updateAllowed() || document.hidden || current !== 'home' || navDepth() > 0) return false;
  if (Date.now() - lastKeyAt < UPDATE_IDLE_MS || pushIsFresh()) return false;
  reloadForUpdate(updatePending);
  return true;
}

/* Resume path: the wearer reopened the app. Reload before any input, unless
   a video is up or they were typing a search. */
function resumeUpdate() {
  if (!updateAllowed() || document.hidden) return false;
  if (current === 'player' || searchTextTyped() || pushIsFresh()) return false;
  reloadForUpdate(updatePending);
  return true;
}

/* Reloads only from the root of the nav stack (WP3). Deeper than Home, it
   first walks history back to depth 0 (navRoot), then reloads on the root
   popstate, so the reloaded page does not start with stale history entries
   that Back would walk into. */
function reloadForUpdate(build) {
  if (navDepth() > 0 || current !== 'home') {
    navRoot(function () { reloadForUpdate(build); });
    return;
  }
  try { progressSave(); } catch (e) { /* best effort */ }
  try { sessionStorage.setItem(UPDATED_FROM_KEY, String(window.GLASSTUBE_BUILD || '?')); }
  catch (e) { /* optional */ }
  try { localStorage.setItem(RELOADED_FOR_KEY, JSON.stringify({ build: build, at: Date.now() })); }
  catch (e) { /* optional */ }
  stopPairPoll();
  try {
    const u = new URL(location.href);
    u.searchParams.set('rv', build);
    location.replace(u.toString());
  } catch (e) {
    // reloadedFor is already set, so this cannot loop: keep polling.
    schedulePoll();
  }
}

/* First thing after an update reload: say so, once, on the lens and in the
   server log. A reload that landed on the same build gets no toast. */
function noteUpdated() {
  let from = '';
  try {
    from = sessionStorage.getItem(UPDATED_FROM_KEY) || '';
    sessionStorage.removeItem(UPDATED_FROM_KEY);
  } catch (e) { return; }
  if (!from) return;
  const to = String(window.GLASSTUBE_BUILD || '');
  updatedFrom = from;
  hudNote('updated', { from: from, to: to });
  if (from === to) return;
  const text = 'Updated · v' + to;
  showToast(text, 'ok', 2500);
}

/* Diagnostics the wearer can actually read back to someone. Every line is a
   fact about this device, not a guess: what the page origin really is (the
   embed routes die on a mismatch), whether the server can resolve a file from
   its own IP, and whether the phone has ever sent one. */
let selfTest = null;

function debugLines() {
  const errs = window.glasstubeErrors || [];
  const out = [];
  out.push(['Build', 'v' + (window.GLASSTUBE_BUILD || '?')]);
  out.push(['Server build', serverBuild ? 'v' + serverBuild : 'not seen yet',
    serverBuild ? serverBuild === window.GLASSTUBE_BUILD : undefined]);
  out.push(['Update', updateLine()]);
  out.push(['Old version?', 'Middle-finger tap on the home screen, then Restart.']);
  out.push(['Last poll', lastPoll.at
    ? Math.round((Date.now() - lastPoll.at) / 1000) + 's ago · ' + lastPoll.text
    : lastPoll.text, lastPoll.at ? lastPoll.ok : undefined]);
  out.push(['Poll every', (nextPollDelay() / 1000) + 's' + (pollFails ? ' · retrying' : '')]);
  out.push(['Instance', instanceId + ' · ' + pollWho()]);
  out.push(['Origin', String(window.location.origin || '?')]);
  out.push(['Viewport', window.innerWidth + 'x' + window.innerHeight]);
  out.push(['Online', navigator.onLine ? 'yes' : 'no', !!navigator.onLine]);
  out.push(['Phone pairing', pairState, pairState.indexOf('paired') === 0 ? true : undefined]);
  out.push(['Pair link', pairLink ? 'durable · survives restarts' : 'code only', !!pairLink]);
  if (pairUrlIgnored()) out.push(['Launcher link', 'still has the old code', false]);
  out.push(['Last from iPhone', lastPushInfo ? lastPushText().replace('Last from iPhone: ', '') : 'nothing yet']);
  out.push(['iPhone app', phoneApp || 'has not pushed yet',
    phoneApp ? !phoneOutOfDate() : undefined]);
  out.push(['Google session', ytSession ? 'on glasses' : 'none', !!ytSession]);
  out.push(['Last good route', savedRoute() || 'none yet']);
  out.push(['Route chain', wayChain.length ? wayChain.map(routeLabel).join(' → ') : 'none yet']);
  out.push(['Now playing', nowPlaying ? (nowPlaying.title || nowPlaying.id) : 'none']);
  out.push(['Phone sent a file', nowPlaying ? (nowPlaying.u ? 'yes' : 'no') : '-',
    nowPlaying ? !!nowPlaying.u : undefined]);
  out.push(['Phone LAN relay', nowPlaying && nowPlaying.r ? 'offered' : 'none']);
  if (selfTest) {
    out.push(['Self-test video', selfTest.id || '-']);
    out.push(['Server can resolve', selfTest.serverText, selfTest.serverOk]);
    if (selfTest.notes) out.push(['Server notes', selfTest.notes]);
    out.push(['Search API', selfTest.searchText, selfTest.searchOk]);
  }
  out.push(['Channel feeds', feedHealth]);
  out.push(['Recents', String(recentsLoad().length)]);
  out.push(['Saved playlists', String(playlistsLoad().length)]);
  out.push(['Resume marks', String(Object.keys(marksLoad()).length)]);
  out.push(['Input filter', 'dup ' + inputStats.dup + ' · enter-lock ' + inputStats.enterLock +
    ' · repeat ' + inputStats.repeat + ' · unknown ' + inputStats.unknown]);
  out.push(['JS errors', errs.length ? errs[errs.length - 1] : 'none', !errs.length]);
  out.push(['Playback fails', playFails.length ? playFails[0] : 'none', !playFails.length]);
  if (playFails.length > 1) out.push(['Earlier fail', playFails[1], false]);
  return out;
}

function updateLine() {
  if (updatePending) {
    return updateAllowed() ? 'v' + updatePending + ' waiting for idle home'
      : 'v' + updatePending + ' did not load · use Restart';
  }
  if (updatedFrom) return 'reloaded from v' + updatedFrom;
  return 'none';
}

function renderDebug() {
  const rows = $('#debug-rows');
  rows.innerHTML = '';
  debugLines().forEach(function (row) {
    const d = document.createElement('div');
    if (row[2] === true) d.className = 'debug-ok';
    if (row[2] === false) d.className = 'debug-bad';
    // Never colour alone: a glyph says it too.
    const mark = row[2] === true ? '✓ ' : (row[2] === false ? '✗ ' : '');
    d.textContent = mark + row[0] + (/\?$/.test(row[0]) ? ' ' : ': ') + row[1];
    rows.appendChild(d);
  });
  const errs = window.glasstubeErrors || [];
  const dump = debugLines().map(r => r[0] + '=' + r[1]).concat([
    'ua=' + navigator.userAgent,
    'pair=' + (pairCode || ''),
    'fails:',
    playFails.length ? playFails.join('\n') : 'none',
    'js:',
    errs.length ? errs.join('\n') : 'none',
  ]).join('\n');
  const logEl = $('#debug-log');
  if (logEl) logEl.value = dump;
  if (current === 'debug') syncFades();
}

/* Ask the server, out loud, whether it can get this exact video - the single
   fact that decides whether the "server" route is worth anything today. */
function runSelfTest() {
  const id = (nowPlaying && nowPlaying.id) ||
    (recentsLoad()[0] && recentsLoad()[0].id) ||
    'dQw4w9WgXcQ';
  selfTest = { id: id, serverText: 'checking...', searchText: 'checking...' };
  renderDebug();
  const auth = ytSession ? '&s=' + encodeURIComponent(ytSession) : '';
  fetch('/api/watch?probe=1&v=' + encodeURIComponent(id) + auth)
    .then(r => r.json())
    .then(d => {
      selfTest.serverOk = !!d.ok;
      selfTest.serverText = d.ok
        ? ('yes · itag ' + d.itag + (d.signedIn ? ' · signed in' : ' · guest'))
        : ('no · ' + String(d.error || 'blocked').slice(0, 80));
      selfTest.notes = (d.notes || []).join(' | ').slice(0, 120);
      renderDebug();
    })
    .catch(e => {
      selfTest.serverOk = false;
      selfTest.serverText = netText(e);
      renderDebug();
    });
  fetch('/api/search?q=test&limit=1')
    .then(r => r.json())
    .then(d => {
      selfTest.searchOk = !!(d.ok && (d.videos || []).length);
      selfTest.searchText = selfTest.searchOk
        ? 'working'
        : ('blocked · ' + String(d.error || 'no results').slice(0, 60));
      renderDebug();
    })
    .catch(e => {
      selfTest.searchOk = false;
      selfTest.searchText = netText(e);
      renderDebug();
    });
}

/* Swipe-proof: no single swipe skips or quits a video (WP7).
   Pinch play/pause · Right +10s · Up -10s · Down menu · Left twice to leave. */
function handlePlayerKey(e) {
  const key = e.key;
  let k = '';
  if (isBackKey(key)) k = 'back';
  else if (key === DPAD.LEFT) k = 'left';
  else if (key === DPAD.RIGHT) k = 'right';
  else if (key === DPAD.UP || key === 'Up' || e.code === 'ArrowUp') k = 'up';
  else if (key === DPAD.DOWN || key === 'Down' || e.code === 'ArrowDown') k = 'down';
  else if (key === DPAD.SELECT || key === ' ') k = 'pinch';
  if (!k) return;
  e.preventDefault();
  if (k !== 'left') leaveArmedAt = 0;
  if (menuIsOpen()) {
    menuKey(k);
    return;
  }
  if (k === 'back') {
    leavePlayer();
    return;
  }
  chromeShow();
  if (upNextIdx >= 0) {
    // Up next: pinch plays now, Left cancels (and arms the guarded exit).
    if (k === 'pinch') playUpNext();
    else if (k === 'left') {
      cancelUpNext();
      updateChrome();
      guardedLeave();
    }
    return;
  }
  if (playerFault()) {
    // Final error: every action on screen is one gesture.
    if (k === 'pinch') openRelay();
    else if (k === 'down' && queue.length > 1) openPlayer((queueIndex + 1) % queue.length, true);
    else if (k === 'left') leavePlayer();
    return;
  }
  if (k === 'left') { guardedLeave(); return; }
  if (k === 'down') { openPlayerMenu(); return; }
  if (k === 'pinch') { playerPinch(); return; }
  seekBy(k === 'right' ? 1 : -1);
}

function handleSearchKey(e) {
  const key = e.key;
  const input = kbInput();
  if (input && document.activeElement === input) {
    // The field holds real focus so a pinch can open the composer. Only the
    // band's keys are taken, with preventDefault so arrows never move the
    // text caret. Everything else (letters, Backspace, the IME's
    // 'Unidentified' keys) is left alone and arrives as typing.
    if (key === DPAD.UP || key === DPAD.RIGHT) { e.preventDefault(); return; }
    if (key === DPAD.DOWN) { e.preventDefault(); moveKey(1, 0); return; }
    if (key === DPAD.LEFT) {
      e.preventDefault();
      if (searchLeftIsBack()) leaveSearch();
      return;
    }
    if (key === DPAD.SELECT) {
      if (typed.trim()) { e.preventDefault(); runSearch(); }
      // Empty field: the pinch goes through, which is what opens the composer.
      return;
    }
    if (key === 'Escape' || key === 'BrowserBack' || key === 'GoBack') {
      e.preventDefault();
      leaveSearch();
    }
    return;
  }
  if (isBackKey(key)) {
    e.preventDefault();
    leaveSearch();
    return;
  }
  if (key === DPAD.UP) { e.preventDefault(); moveKey(-1, 0); return; }
  if (key === DPAD.DOWN) { e.preventDefault(); moveKey(1, 0); return; }
  if (key === DPAD.LEFT) {
    e.preventDefault();
    if (searchLeftIsBack()) leaveSearch();
    else moveKey(0, -1);
    return;
  }
  if (key === DPAD.RIGHT) { e.preventDefault(); moveKey(0, 1); return; }
  if (key === DPAD.SELECT || key === ' ') { e.preventDefault(); pressKey(); return; }
  // A real keyboard is attached when rehearsing on a computer. Let it type.
  if (key && key.length === 1 && typed.length < KB_MAX) {
    e.preventDefault();
    typed = cleanQuery(typed + key);
    searchTyped();
  }
}

/* ---- Input arbiter -----------------------------------------------------

   Every key the Neural Band (or a keyboard, or the harness) sends goes
   through here once, in the capture phase, before anything else sees it.
   resolveKey turns it into one gesture name without guessing: e.key, then
   e.code, then a single printable e.key as { char } (Search types with it),
   then the DOM keyCodes 37-40/13 and the Android keycodes 19-22, 23 and 66.
   Anything else is ignored. Then two filters keep one physical gesture from
   doing two things: the same gesture inside DUP_MS is one
   gesture, and Enter inside ENTER_LOCK_MS of a swipe is a side effect of
   the swipe, not a pinch. Held Enter (repeat) never fires again. Do not
   filter on isTrusted: the harness and selftest dispatch synthetic keys. */
const INPUT = {
  DUP_MS: 120,
  ENTER_LOCK_MS: 320,
};
const INPUT_KEYS = {
  ArrowUp: 'up', Up: 'up', ArrowDown: 'down', Down: 'down',
  ArrowLeft: 'left', Left: 'left', ArrowRight: 'right', Right: 'right',
  Enter: 'enter', NumpadEnter: 'enter', Select: 'enter',
  Escape: 'back', Esc: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back',
};
const INPUT_CODES = {
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'enter',
  19: 'up', 20: 'down', 21: 'left', 22: 'right', 23: 'enter', 66: 'enter',
};
/* What each gesture looks like to the per-screen handlers, which still read
   e.key (the player mapping belongs to WP7 and is not changed here). */
const INPUT_AS_KEY = {
  up: DPAD.UP, down: DPAD.DOWN, left: DPAD.LEFT, right: DPAD.RIGHT,
  enter: DPAD.SELECT, back: 'Escape',
};
const inputStats = { dup: 0, enterLock: 0, repeat: 0, unknown: 0 };
let inputLast = '';
let inputLastAt = 0;
let inputArrowAt = 0;

function resolveKey(e) {
  if (!e) return null;
  const k = e.key;
  if (k && INPUT_KEYS[k]) return { name: INPUT_KEYS[k] };
  if (e.code && INPUT_KEYS[e.code]) return { name: INPUT_KEYS[e.code] };
  // A printable e.key wins over the keyCode tables: DOM keyCode 66 is 'b',
  // which the Android table would otherwise read as Enter.
  if (k && k.length === 1) {
    return (e.ctrlKey || e.metaKey || e.altKey) ? null : { char: k };
  }
  const kc = Number(e.keyCode || e.which || 0);
  if (INPUT_CODES[kc]) return { name: INPUT_CODES[kc] };
  return null;
}

/* The gesture the screen sees: a small event-shaped object, so handlers that
   read e.key work the same for Android keycodes and for real arrow keys. */
function inputEvent(e, r) {
  return {
    key: r.char || INPUT_AS_KEY[r.name],
    code: e.code || '',
    repeat: !!e.repeat,
    gesture: r.name || 'char',
    preventDefault: function () { e.preventDefault(); },
  };
}

document.addEventListener('keydown', function (e) {
  inputTestNote('keydown', e);
  // Any key is activity (WP1): it keeps the fast poll cadence and holds off
  // an update reload, even a key the arbiter then ignores.
  lastKeyAt = Date.now();
  lastActiveAt = lastKeyAt;
  pollSoonerIfIdle();
  const r = resolveKey(e);
  if (!r && !pendingPush) { inputStats.unknown++; return; }
  // WP8: while Search's native field holds focus, printable keys and
  // Backspace are typing and go to the field untouched, and a pinch on an
  // empty field passes through so it can open the system composer. Arrows
  // and Escape are still taken (preventDefault keeps the caret still).
  const field = current === 'search' ? kbInput() : null;
  const inField = !!field && document.activeElement === field;
  const fieldTyping = inField && !!r && (!!r.char || e.key === 'Backspace');
  if (!fieldTyping && !(inField && r && r.name === 'enter' && !typed.trim())) e.preventDefault();
  const now = Date.now();
  // Any resolved gesture is a user activation: let WP5's player unlock the
  // video element on it synchronously, inside the gesture, while it is still
  // locked.
  if (!Player.unlocked()) {
    try { Player.unlock(); } catch (x) { /* unlock is best effort */ }
  }
  // WP4: a push held while hidden plays on the first key when the WebView
  // never reports visible. That key is consumed, so it is not also read as
  // a command on the screen underneath.
  if (pendingPush) { e.preventDefault(); releasePendingPush(); return; }
  if (inputTest && current === 'debug') return;
  if (fieldTyping) return;
  const name = r.name || ('char:' + r.char);
  // A filtered Enter is never a pinch, so it must not reach the field either.
  if (r.name === 'enter' && e.repeat) { e.preventDefault(); inputStats.repeat++; return; }
  if (!r.char && name === inputLast && now - inputLastAt < INPUT.DUP_MS) {
    e.preventDefault();
    inputStats.dup++;
    inputLastAt = now;
    return;
  }
  if (r.name === 'enter' && now - inputArrowAt < INPUT.ENTER_LOCK_MS) {
    e.preventDefault();
    inputStats.enterLock++;
    return;
  }
  inputLast = name;
  inputLastAt = now;
  if (r.name === 'up' || r.name === 'down' || r.name === 'left' || r.name === 'right') {
    inputArrowAt = now;
  }
  inputDispatch(inputEvent(e, r));
}, true);

document.addEventListener('keyup', function (e) {
  inputTestNote('keyup', e);
}, true);

/* One place decides who gets the gesture: the player (its own mapping, WP7
   adds the player menu inside it), Search (typing and the letter grid), or
   the list screens. */
function inputDispatch(ev) {
  if (current === 'player') {
    handlePlayerKey(ev);
    return;
  }
  if (current === 'search') {
    handleSearchKey(ev);
    return;
  }
  handleDefaultKey(ev);
}

function handleDefaultKey(ev) {
  const g = ev.gesture;
  if (g === 'back' || g === 'left') {
    // Left on Home is a no-op apart from a short pulse on the title.
    goBack();
    return;
  }
  if (g === 'up') { moveFocus('up'); return; }
  if (g === 'down') { moveFocus('down'); return; }
  if (g === 'right') {
    if (current === 'list') { moveFocusBy(4); return; }
    if (current === 'settings' && settingsCycles(document.activeElement)) {
      activateFocused();
      return;
    }
    moveFocus('down');
    return;
  }
  if (g === 'enter') activateFocused();
}

/* Settings rows with a value (the <small> on the right) cycle on Right as
   well as on a pinch. Diagnostics, the last row, only opens on a pinch. */
function settingsCycles(el) {
  return !!(el && el.closest && el.closest('#screen-settings') && el.querySelector('small'));
}

/* ---- Diagnostics: Input test ---------------------------------------------

   Records the next INPUT_TEST_MAX raw key events exactly as the band sends
   them (key, code, keyCode, repeat, gap since the previous event, how long
   the key was held) so the arbiter's thresholds can be checked against the
   real hardware. While it runs, keys only record; it stops by itself after
   INPUT_TEST_IDLE_MS without a key, then reports to the server log. */
const INPUT_TEST_MAX = 20;
const INPUT_TEST_IDLE_MS = 8000;
let inputTest = null;

function inputTestStart() {
  if (inputTest) return;
  inputTest = { rows: [], prevAt: 0, down: {}, idle: 0 };
  inputTestArm();
  renderInputTest();
}

function inputTestArm() {
  if (!inputTest) return;
  clearTimeout(inputTest.idle);
  inputTest.idle = setTimeout(inputTestEnd, INPUT_TEST_IDLE_MS);
}

function inputTestNote(type, e) {
  if (!inputTest || inputTest.done) return;
  const now = Date.now();
  if (type === 'keyup') {
    const row = inputTest.down[(e && (e.key || e.code || e.keyCode)) || '?'];
    if (row && row.held == null) {
      row.held = now - row.at;
      renderInputTest();
    }
    return;
  }
  const row = {
    type: type,
    key: e ? String(e.key || '') : '',
    code: e ? String(e.code || '') : '',
    keyCode: e ? Number(e.keyCode || 0) : 0,
    repeat: !!(e && e.repeat),
    gap: inputTest.prevAt ? now - inputTest.prevAt : null,
    held: null,
    at: now,
  };
  inputTest.prevAt = now;
  inputTest.rows.push(row);
  if (e) inputTest.down[e.key || e.code || e.keyCode || '?'] = row;
  inputTestArm();
  renderInputTest();
  if (inputTest.rows.length >= INPUT_TEST_MAX) inputTestEnd();
}

function inputTestEnd() {
  if (!inputTest || inputTest.done) return;
  clearTimeout(inputTest.idle);
  inputTest.done = true;
  renderInputTest();
  hudNote('input-test', {
    events: inputTest.rows.map(function (r) {
      return { t: r.type, key: r.key, code: r.code, kc: r.keyCode, rep: r.repeat, gap: r.gap, held: r.held };
    }),
    stats: Object.assign({}, inputStats),
  });
  // Keep the result on screen; the next key works normally again.
  const shown = inputTest;
  inputTest = null;
  renderInputTest(shown);
}

function renderInputTest(state) {
  const box = $('#input-log');
  if (!box) return;
  const t = state || inputTest;
  if (!t) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const head = t.done
    ? 'Input test · ' + t.rows.length + ' events · sent'
    : 'Input test · ' + t.rows.length + '/' + INPUT_TEST_MAX + ' · swipe or pinch';
  box.innerHTML = '';
  const h = document.createElement('div');
  h.className = 'input-log-head';
  h.textContent = head;
  box.appendChild(h);
  t.rows.slice(-8).forEach(function (r) {
    const d = document.createElement('div');
    d.className = 'input-log-row';
    d.textContent = (r.type === 'keydown' ? '' : r.type + ' ') +
      (r.key || r.code || '?') + ' · ' + r.keyCode +
      (r.repeat ? ' · rep' : '') +
      ' · ' + (r.gap == null ? 'first' : '+' + r.gap + 'ms') +
      ' · held ' + (r.held == null ? '-' : r.held + 'ms');
    box.appendChild(d);
  });
}

document.querySelectorAll('#screen-home [data-menu]').forEach(btn => {
  btn.addEventListener('click', () => {
    const menu = btn.getAttribute('data-menu');
    if (menu === 'recents') openRecents();
    if (menu === 'channels') openChannels();
    if (menu === 'playlists') openPlaylists();
    if (menu === 'phone') openPhone();
    if (menu === 'continue') openContinue();
    if (menu === 'missed') openMissed();
    if (menu === 'search') openSearch();
    if (menu === 'library') openLibrary();
    if (menu === 'settings') openSettings();
  });
});

function openSettings() {
  navTo({ name: 'settings', render: function () { renderSettings(); show('settings'); } });
}

function openDebug() {
  navTo({ name: 'debug', render: function () { renderDebug(); show('debug'); } });
}

window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => {
  setOffline(false);
  if (!pairCode) ensureListening();
  pollNow();
});

/* Page lifecycle (WP1). The glasses keep this page for days and hide and show
   it as the wearer comes and goes, so each return is a moment to catch up:
   poll now, and if a new build is waiting, load it before any input. */
function onResume() {
  lastActiveAt = Date.now();
  // WP4: a push held while hidden plays now that the wearer can see it. It
  // counts as a fresh push, so resumeUpdate() will not reload over it.
  releasePendingPush();
  if (resumeUpdate()) return;
  pollNow();
}
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) { onResume(); return; }
  // Hidden: save progress now (it is otherwise saved at most every 10s while
  // playing) and drop to the hidden poll cadence.
  if (current === 'player') progressSave();
  if (!pollBusy && pairKey()) schedulePoll(nextPollDelay());
});
let firstPageshow = true;
window.addEventListener('pageshow', function (e) {
  // The first pageshow is this page loading, not the wearer coming back.
  if (firstPageshow && !e.persisted) { firstPageshow = false; return; }
  firstPageshow = false;
  onResume();
});
window.addEventListener('focus', function () { pollNow(); });
// Key activity (lastKeyAt, lastActiveAt, pollSoonerIfIdle) is recorded by
// the WP3 input arbiter, the one keydown path.

// "Link a different phone" is how you hand the glasses to a different phone,
// so it has to drop the durable link too, not just the six characters on
// screen. It takes two pinches: one stray pinch must not unpair the iPhone.
function disarmUnlink() {
  if (unlinkArmed) clearTimeout(unlinkArmed);
  unlinkArmed = 0;
  const btn = $('#btn-pair-new');
  if (btn) btn.textContent = PAIR_NEW_LABEL;
}
$('#btn-pair-new').addEventListener('click', () => {
  if (!unlinkArmed) {
    $('#btn-pair-new').textContent = 'Pinch again to unlink your iPhone';
    unlinkArmed = setTimeout(disarmUnlink, UNLINK_ARM_MS);
    return;
  }
  disarmUnlink();
  hudNote('unlink');
  stopPairPoll();
  // WP6: only the full link token these glasses held is ever superseded.
  if (/^[a-f0-9]{64}$/i.test(linkStored())) pairReplaces = linkStored();
  pairIgnoreUrl();
  pairPairedSet(false);
  pairCode = '';
  pairLastSeq = -1;
  pairCodeStore('');
  linkStore('');
  newPairCode();
});
$('#btn-debug').addEventListener('click', openDebug);
$('#btn-input-test').addEventListener('click', inputTestStart);
const relayBtn = $('#btn-relay');
if (relayBtn) relayBtn.addEventListener('click', openRelay);
const kbField = kbInput();
if (kbField) {
  kbField.addEventListener('input', searchFromInput);
  kbField.addEventListener('compositionend', searchFromInput);
  // The composer commits with 'change' (or Enter, handled in handleSearchKey).
  kbField.addEventListener('change', function (e) {
    if (kbBlurring || current !== 'search') return;
    searchFromInput(e);
    if (typed.trim()) runSearch();
  });
  // A tap on the field (or the system focusing it) moves the cursor there.
  kbField.addEventListener('focus', function () {
    if (current !== 'search' || keyRow === KB_INPUT_ROW) return;
    keyRow = KB_INPUT_ROW;
    renderSearch();
  });
}
$('#btn-retest').addEventListener('click', runSelfTest);
$('#btn-copy-debug').addEventListener('click', function () {
  const t = ($('#debug-log') && $('#debug-log').value) || 'No errors yet.';
  function ok() {
    const hint = $('#debug-copy-msg');
    if (hint) hint.textContent = 'Copied. Paste it in chat.';
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(ok).catch(function () {});
    return;
  }
  const el = $('#debug-log');
  if (el) {
    el.focus();
    el.select();
    try { document.execCommand('copy'); ok(); } catch (e) {}
  }
});
$('#btn-sound').addEventListener('click', () => {
  if (!sound) return;
  sound.setEnabled(!sound.enabled());
  renderSettings();
  updateChrome();
});
$('#btn-captions').addEventListener('click', () => {
  if (!prefs) return;
  prefs.setCaptions(!prefs.captions());
  renderSettings();
});
$('#btn-speed').addEventListener('click', () => {
  if (!prefs) return;
  prefs.cycleSpeed();
  renderSettings();
});
$('#btn-repeat').addEventListener('click', () => {
  if (!prefs) return;
  prefs.cycleRepeat();
  renderSettings();
});
$('#btn-shuffle').addEventListener('click', () => {
  if (!prefs) return;
  prefs.setShuffle(!prefs.shuffle());
  renderSettings();
});
$('#btn-picture').addEventListener('click', () => {
  if (!prefs) return;
  prefs.setAudioOnly(!prefs.audioOnly());
  renderSettings();
});
$('#btn-sleep').addEventListener('click', () => {
  if (!prefs) return;
  prefs.cycleSleep();
  armSleep();
  renderSettings();
});

function ensureListening() {
  pairCode = pairCodeStored();
  pairLink = linkStored();
  if (pairKey()) {
    startPairPoll();
    updateHomePhoneHint();
    return;
  }
  newPairCode();
}

// Seed the nav stack's root in history, so the first pushState has a depth-0
// entry to come back to (system Back on firmware v125.1+, and ArrowLeft).
try { history.replaceState({ gt: 1, d: 0 }, ''); } catch (e) { /* no history API */ }

// Leaving the page saves progress now too (hiding it is handled above).
window.addEventListener('pagehide', function () {
  if (current === 'player') progressSave();
});
sessionStore(sessionLoad());
renderSettings();
pairBoot();
renderHome();
if (prefs && prefs.sleep()) armSleep(true);
ensureListening();
setInterval(function () { if (!pollBusy) maybeUpdate(); }, UPDATE_CHECK_MS);
setInterval(pollWatchdog, WATCHDOG_MS);

/* Launch stamp: the build shows on Home for a few seconds after the splash,
   so a deploy that reached the glasses can be seen to have landed. */
function showBuildChip() {
  const chip = $('#build-chip');
  if (!chip) return;
  chip.textContent = 'v' + (window.GLASSTUBE_BUILD || '?');
  chip.classList.remove('chip-out');
  setTimeout(function () { chip.classList.add('chip-out'); }, BUILD_CHIP_MS);
}

function hideSplash() {
  const splash = $('#splash');
  if (!splash || splash.classList.contains('splash-out')) return;
  splash.classList.add('splash-out');
  setTimeout(function () { splash.classList.add('hidden'); }, 220);
  focusFirst();
  if (window.glasstubeFitStage) window.glasstubeFitStage();
}

setTimeout(function () {
  hideSplash();
  showBuildChip();
  noteUpdated();
}, 300);
