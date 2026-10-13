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
const PAIR_POLL_MS = 2000;
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
let pairPolls = 0;
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
let sleepUntil = 0;
let sleepWatch = 0;
let channelPage = 0;
let listKind = '';
let prefetched = {};
let ytSession = '';
let library = null;
let libraryErr = '';
let lastQuery = '';
let phoneApp = '';
/* interim: the owning WP (WP1) provides the full version. Written by the WP3
   input arbiter on every resolved keydown; WP1's idle self-update reads them. */
let lastKeyAt = 0;
let lastActiveAt = Date.now();

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

function recentsAdd(video) {
  const next = recentsLoad().filter(v => v && v.id !== video.id);
  next.unshift({
    id: video.id,
    title: video.title || 'YouTube video',
    channel: video.channel || '',
    thumb: video.thumb || ('https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'),
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

function pairCodeStored() {
  try { return localStorage.getItem(PAIR_KEY) || ''; }
  catch (e) { return ''; }
}

function pairCodeStore(c) {
  try {
    if (c) localStorage.setItem(PAIR_KEY, c);
    else localStorage.removeItem(PAIR_KEY);
  } catch (e) { /* optional */ }
}

/* The six character code is a bootstrap and expires on purpose. The link token
   is the actual pairing: long, unguessable, and good for a year past the last
   time either device spoke. Talking to the server with the token is what stops
   the phone asking for a code again every time it reopens. */
function linkStored() {
  try { return localStorage.getItem(LINK_KEY) || ''; }
  catch (e) { return ''; }
}

function linkStore(t) {
  pairLink = String(t || '');
  try {
    if (pairLink) localStorage.setItem(LINK_KEY, pairLink);
    else localStorage.removeItem(LINK_KEY);
  } catch (e) { /* optional */ }
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
   into view or the band scrolls into nothing the wearer can see. */
function reveal(el) {
  if (!el || !el.scrollIntoView) return;
  try { el.scrollIntoView({ block: 'nearest' }); }
  catch (e) { el.scrollIntoView(false); }
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

function isNetErr(e) {
  return /failed to fetch|networkerror|offline|internet|load failed|not connected|HTTP 5/i
    .test(String((e && e.message) || e || ''));
}

function netText(e) {
  const s = String((e && e.message) || e || '');
  if (isNetErr(s)) return 'No internet. Retrying...';
  return s;
}

function setOffline(on) {
  netOffline = !!on;
  if (on) setStatus('No internet. Retrying...', true);
  else if (!nowPlaying) setStatus('');
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
  if ($('#repeat-state')) $('#repeat-state').textContent = prefs ? prefs.repeatLabel() : 'All';
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
  prefetched = {};
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

function armSleep() {
  const mins = prefs ? prefs.sleep() : 0;
  sleepUntil = mins ? Date.now() + mins * 60000 : 0;
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
      thumb: v.thumb || ('https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'),
    })),
  });
  playlistsSave(next);
}

function updateHomePhoneHint() {
  const el = document.querySelector('[data-menu="phone"] small');
  if (!el) return;
  if (pairCode) el.textContent = 'Code ' + pairCode + ' · listening';
  else el.textContent = 'Paste a YouTube link on your iPhone';
}

function renderHome() {
  updateHomePhoneHint();
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
    p.textContent = emptyText || 'Nothing here yet.';
    box.appendChild(p);
    if (emptyAction) items = [Object.assign({ key: 'empty-action' }, emptyAction)];
  }
  if (items.length) {
    items.slice(0, MAX_LIST).forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'focusable list-btn';
      if (item.key) btn.setAttribute('data-key', item.key);
      if (item.video) btn.setAttribute('data-video', '1');
      if (item.count) btn.setAttribute('data-count', '1');
      if (item.thumb) {
        const shot = document.createElement('span');
        shot.className = 'list-shot';
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.src = item.thumb;
        shot.appendChild(img);
        if (item.duration) {
          const d = document.createElement('span');
          d.className = 'list-dur';
          d.textContent = item.duration;
          shot.appendChild(d);
        }
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
    const bits = [];
    if (v.channel) bits.push(v.channel);
    if (v.meta) bits.push(v.meta);
    else if (v.views) bits.push(v.views);
    const seen = markLabel(v.id);
    if (seen) bits.push(seen);
    return {
      key: v.id,
      video: true,
      count: true,
      label: v.title || 'YouTube video',
      sub: bits.join(' · '),
      thumb: v.thumb,
      duration: v.duration || '',
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
      label: 'Play all',
      sub: videos.length + ' videos, then the next one starts itself',
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
  prefetched = {};
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
  if (msg) msg.textContent = netOffline ? 'No internet. Retrying...' : (text || 'Loading...');
}

function setPlayGate(on, title, text) {
  const gate = $('#play-gate');
  const name = $('#play-gate-title');
  const msg = $('#play-gate-msg');
  if (!gate) return;
  gate.classList.toggle('hidden', !on);
  if (on) {
    const load = $('#load-gate');
    if (load) load.classList.add('hidden');
  }
  if (name) name.textContent = title || (nowPlaying && nowPlaying.title) || 'YouTube video';
  if (msg && text) msg.textContent = text;
}

/* Route memory. Whatever played last time is tried first next time, so a
   working setup stops paying for three dead attempts on every video. */
function savedRoute() {
  try {
    const r = localStorage.getItem(ROUTE_KEY) || '';
    return Player.routes().indexOf(r) >= 0 ? r : '';
  } catch (e) { return ''; }
}

function rememberRoute(r) {
  if (!r) return;
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
  return chain;
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

function skipUnplayable(err, code) {
  playFailNote(err, code);
  if (nowPlaying && nowPlaying.id) skipIds[nowPlaying.id] = true;
  for (let i = 1; i <= queue.length; i++) {
    const idx = (queueIndex + i) % queue.length;
    const v = queue[idx];
    if (v && v.id && !skipIds[v.id]) {
      setStatus('Skipped one YouTube would not play.', false);
      openPlayer(idx, true);
      return;
    }
  }
  setLoading(false);
  setPlayGate(false);
  blockedFor = (nowPlaying && nowPlaying.id) || '';
  $('#player-error').textContent = queue.length > 1
    ? 'Nothing in this list would play. ' + blockedText(code, err)
    : blockedText(code, err);
  $('#player-error').classList.remove('hidden');
  updateChrome();
}

/* Quietly move to the next route for this video. Returns true when another
   attempt is coming, false when the chain is exhausted. */
function tryNextWay(videoId, err, code) {
  if (!videoId || isDeadVideo(code) || wayFor !== videoId) return false;
  if (loadRetry) return true;
  if (wayPos + 1 >= wayChain.length) return false;
  playFailNote(err, code);
  wayPos += 1;
  loadRetry = setTimeout(function () {
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
  const video = queue[index];
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
  nowPlaying = video;
  recentsAdd(video);
  $('#player-title').textContent = video.title || 'YouTube video';
  $('#player-channel').textContent = [video.channel || '', video.meta || ''].filter(Boolean).join(' · ');
  $('#player-error').classList.add('hidden');
  $('#player-time').textContent = '0:00 / 0:00';
  $('#player-fill').style.width = '0%';
  const buf = $('#player-buffer');
  if (buf) buf.style.width = '0%';
  needGesture = false;
  setPlayGate(false);
  setLoading(true, video.title, wayPos === 0 ? 'Loading...' : 'Trying ' + routeLabel(wayChain[wayPos]) + '...');
  show('player');
  if (typeof Player === 'undefined') {
    $('#player-error').textContent = 'Player script missing.';
    $('#player-error').classList.remove('hidden');
    return;
  }
  const attempt = wayPos;
  const route = wayChain[wayPos] || 'proxy';
  Player.setHandlers(playNext, updateChrome);
  hudNote('route', { route: route, attempt: attempt, chain: wayChain.join('>'), hasU: !!video.u });
  Player.load(video, autoplay, startAt || 0, route).then(function (ok) {
    hudNote('loaded', { route: route, ok: !!ok, err: ok ? '' : String(Player.lastError() || ''),
      code: Player.lastCode ? Player.lastCode() : 0 });
    if (!ok) {
      const err = Player.lastError() || 'Could not start this route.';
      const code = Player.lastCode ? Player.lastCode() : 0;
      if (!tryNextWay(video.id, err, code)) skipUnplayable(err, code);
    } else {
      setOffline(false);
      prefetchNext();
    }
    updateChrome();
    if (autoplay) {
      setTimeout(function () {
        if (current !== 'player') return;
        if (nowPlaying && nowPlaying.id !== video.id) return;
        if (wayPos !== attempt) return;
        const snap = Player.snapshot();
        hudNote('check3s', { route: route, playing: !!snap.playing, paused: !!snap.paused,
          error: snap.error || '', time: snap.time });
        if (snap.playing || snap.paused || snap.error) return;
        needGesture = true;
        setPlayGate(true, video.title, 'Enter to play');
        updateChrome();
      }, 3200);
      setTimeout(function () {
        if (current !== 'player') return;
        if (nowPlaying && nowPlaying.id !== video.id) return;
        if (wayPos !== attempt) return;
        const snap = Player.snapshot();
        if (snap.playing || snap.paused || snap.ended || snap.error) return;
        if (snap.time > 0.4) return;
        hudNote('stalled', { route: route, time: snap.time, gate: needGesture });
        if (!tryNextWay(video.id, routeLabel(route) + ' stalled', 0) && !needGesture) {
          skipUnplayable(routeLabel(route) + ' stalled', 0);
        }
      }, 12000);
    }
  });
}

/* Warm the next video on the server route so the gap between tracks is a
   beat, not a stall. Harmless when the route ends up being the phone file. */
function prefetchNext() {
  const nxt = queue[queueIndex + 1] || (prefs && prefs.repeat() === 'all' ? queue[0] : null);
  if (!nxt || !nxt.id || nxt.id === (nowPlaying && nowPlaying.id)) return;
  if (nxt.u || prefetched[nxt.id]) return;
  prefetched[nxt.id] = true;
  try {
    fetch('/api/watch?v=' + encodeURIComponent(nxt.id) + (ytSession ? '&s=' + encodeURIComponent(ytSession) : ''), {
      method: 'HEAD',
    }).catch(function () { /* warming only */ });
  } catch (e) { /* warming only */ }
}

function playNext() {
  if (!queue.length) return;
  const mode = prefs ? prefs.repeat() : 'all';
  if (mode === 'one') {
    openPlayer(queueIndex, true);
    return;
  }
  if (prefs && prefs.shuffle() && queue.length > 1) {
    let n = queueIndex;
    while (n === queueIndex) n = Math.floor(Math.random() * queue.length);
    openPlayer(n, true);
    return;
  }
  if (queueIndex + 1 < queue.length) {
    openPlayer(queueIndex + 1, true);
    return;
  }
  if (mode === 'all' && queue.length > 1) {
    openPlayer(0, true);
    return;
  }
  setStatus('End of list.', false);
}

function playPrev() {
  if (queue.length < 2) {
    goBack();
    return;
  }
  const prev = (queueIndex - 1 + queue.length) % queue.length;
  openPlayer(prev, true);
}

/* A push from the phone. It can carry videos, a channel list, a channel to
   open, or the phone's Google session so the glasses can search.

   It deliberately does NOT navigate away any more. The old build jumped the
   whole HUD to the phone's plain-HTTP relay page, which threw away the queue,
   the settings and every Neural Band binding. The relay is still honoured, but
   only as something the wearer chooses from the error screen. */
function applyPush(dest) {
  if (!dest) return;
  if (dest.kind === 'session') {
    sessionStore(dest.session || '');
    library = null;
    setStatus(dest.session ? 'Signed in from your phone.' : 'Signed out.', false);
    renderHome();
    return;
  }
  if (dest.kind === 'channels') {
    channelsSave(dest.channels || []);
    if (listKind === 'channels' && current === 'list') navRefresh();
    if (current !== 'player') setStatus('Channels updated from your phone.');
    return;
  }
  if (dest.kind === 'channel' && dest.id) {
    loadChannel({ id: dest.id, name: dest.name || 'Channel' });
    return;
  }
  if (dest.app) phoneApp = String(dest.app);
  const list = (dest.videos && dest.videos.length) ? dest.videos : [dest];
  const name = dest.playlist || 'From iPhone';
  skipIds = {};
  prefetched = {};
  // A single-video push carries its file at the top level, not on the row.
  if (dest.u || dest.r) {
    list.forEach(function (v) {
      if (!v || (!dest.id || v.id === dest.id)) {
        if (v && !v.u && dest.u) v.u = dest.u;
        if (v && !v.r && dest.r) v.r = dest.r;
      }
    });
  }
  const ordered = maybeShuffle(list);
  // The pushed list goes on the nav stack under the player, so Back lands on
  // it with the played row focused. Navigate before replacing the queue:
  // leaving a playing video saves its progress against its own queue.
  navPushList(name, ordered);
  queue = ordered.map(v => Object.assign({}, v, { _listTitle: name }));
  playlistRemember(name, list);
  diagSend('push', {
    id: (queue[0] && queue[0].id) || '',
    hasU: !!(queue[0] && queue[0].u),
    hasR: !!(queue[0] && queue[0].r),
    origin: String(window.location.origin || ''),
  });
  navPlayer(0, resumeAt(queue[0] && queue[0].id));
  setStatus(list.length > 1
    ? 'Playing ' + name + ' · ' + list.length + ' videos.'
    : 'Playing from your phone.');
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
  $('#player-time').textContent = fmtTime(snap.time) + ' / ' + fmtTime(snap.duration);
  const pct = snap.duration ? Math.min(100, (snap.time / snap.duration) * 100) : 0;
  $('#player-fill').style.width = pct + '%';
  const buf = $('#player-buffer');
  if (buf) {
    const bpct = snap.duration ? Math.min(100, (snap.buffered / snap.duration) * 100) : 0;
    buf.style.width = bpct + '%';
  }
  const pos = queue.length > 1 ? ((queueIndex + 1) + '/' + queue.length + ' · ') : '';
  const nxt = queue[queueIndex + 1] || (prefs && prefs.repeat() === 'all' ? queue[0] : null);
  let phase = 'Loading';
  if (snap.playing) phase = 'Enter pause';
  else if (snap.error && nowPlaying && blockedFor === nowPlaying.id) phase = 'Blocked';
  else if (snap.error) phase = 'Trying another way';
  else if (snap.paused) phase = 'Paused · Enter play';
  else if (snap.ended) phase = 'Ended · Enter play';
  else if (needGesture) phase = 'Enter to play';
  else if (snap.buffering) phase = 'Buffering';
  $('#player-hint').textContent = pos + phase +
    (queue.length > 1 ? ' · Up last · Down next' : ' · Up -10s') +
    ' · Left back · Right +10s';
  if ($('#player-next')) {
    $('#player-next').textContent = nxt && nxt.title && queue.length > 1
      ? ('Next: ' + String(nxt.title).slice(0, 44))
      : '';
  }
  const title = nowPlaying && nowPlaying.title;
  if (snap.playing) {
    needGesture = false;
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
    progressSave();
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
    if (id && tryNextWay(id, snap.error, code)) {
      setLoading(true, title, 'Trying ' + routeLabel(wayChain[wayPos]) + '...');
    } else if (id) {
      skipUnplayable(snap.error, code);
    }
  } else if (snap.paused || snap.ended) {
    needGesture = false;
    setPlayGate(true, title, snap.ended ? 'Ended · Enter to play' : 'Paused · Enter to play');
  } else if (needGesture) {
    setPlayGate(true, title, 'Enter to play');
  } else if (snap.buffering && snap.time > 0.4) {
    setLoading(true, title, 'Buffering...');
  } else {
    setLoading(true, title, 'Loading...');
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
   pinch, which is exactly enough to drive a letter grid, so that is what this
   is: a 10-wide grid the wearer walks with the D-pad. Recent queries sit above
   it because re-running a search should never cost 12 pinches. */

const KEY_ROWS = [
  'ABCDEFGHIJ'.split(''),
  'KLMNOPQRST'.split(''),
  'UVWXYZ0123'.split(''),
  '456789'.split('').concat([' ']),
];
const KEY_ACTIONS = [
  { label: 'Back', act: 'back', wide: true },
  { label: 'Delete', act: 'del', wide: true },
  { label: 'Clear', act: 'clear', wide: true },
  { label: 'Search', act: 'go', wide: true, primary: true },
];

let typed = '';
let keyRow = 0;
let keyCol = 0;

function keyGrid() {
  return KEY_ROWS.concat([KEY_ACTIONS.map(a => a.label)]);
}

function renderSearch() {
  const box = $('#kb-grid');
  if (!box) return;
  box.innerHTML = '';
  const grid = keyGrid();
  grid.forEach((row, r) => {
    const line = document.createElement('div');
    line.className = 'kb-row' + (r === grid.length - 1 ? ' kb-actions' : '');
    row.forEach((cell, c) => {
      const b = document.createElement('button');
      const action = r === grid.length - 1 ? KEY_ACTIONS[c] : null;
      b.className = 'kb-key' +
        (r === keyRow && c === keyCol ? ' kb-on' : '') +
        (action && action.primary ? ' kb-go' : '') +
        (action ? ' kb-wide' : '');
      b.textContent = cell === ' ' ? 'Space' : cell;
      if (cell === ' ') b.classList.add('kb-space');
      b.addEventListener('click', () => { keyRow = r; keyCol = c; pressKey(); });
      line.appendChild(b);
    });
    box.appendChild(line);
  });
  const field = $('#kb-text');
  if (field) {
    field.textContent = typed || 'Type a search';
    field.classList.toggle('kb-empty', !typed);
  }
  const recents = $('#kb-recent');
  if (recents) {
    recents.innerHTML = '';
    queriesLoad().slice(0, 4).forEach(q => {
      const b = document.createElement('button');
      b.className = 'kb-recent-btn';
      b.textContent = q;
      b.addEventListener('click', () => { typed = q; runSearch(); });
      recents.appendChild(b);
    });
    recents.classList.toggle('hidden', !queriesLoad().length);
  }
}

function moveKey(dr, dc) {
  const grid = keyGrid();
  keyRow = (keyRow + dr + grid.length) % grid.length;
  const row = grid[keyRow];
  if (dr !== 0) keyCol = Math.min(keyCol, row.length - 1);
  else keyCol = (keyCol + dc + row.length) % row.length;
  renderSearch();
}

function pressKey() {
  const grid = keyGrid();
  if (keyRow === grid.length - 1) {
    const action = KEY_ACTIONS[keyCol];
    if (!action) return;
    if (action.act === 'back') { goBack(); return; }
    if (action.act === 'del') typed = typed.slice(0, -1);
    if (action.act === 'clear') typed = '';
    if (action.act === 'go') { runSearch(); return; }
    renderSearch();
    return;
  }
  if (typed.length < 60) typed += grid[keyRow][keyCol];
  renderSearch();
}

/* Opening Search from Home starts empty. Coming back to it from results is a
   nav-stack pop, which redraws it without clearing what was typed. */
function openSearch() {
  typed = '';
  keyRow = 0;
  keyCol = 0;
  navTo({ name: 'search', render: function () { show('search'); renderSearch(); } });
}

/* Results open as their own entry right away ('Searching...'), and fill in
   only if the wearer has not navigated since (navGen). */
function runSearch() {
  const q = typed.trim();
  if (!q) return;
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
    $('#pair-code').textContent = pairCode || '······';
    $('#pair-help').textContent = pairLink
      ? 'Your iPhone stays linked on its own. This code is only for linking a new phone.'
      : 'Type this code in the GlassTube iPhone app.';
    startPairPoll();
  } else {
    newPairCode();
  }
}

function newPairCode() {
  if (pairMintTimer) {
    clearTimeout(pairMintTimer);
    pairMintTimer = 0;
  }
  $('#pair-code').textContent = '------';
  $('#pair-help').textContent = netOffline ? 'No internet. Retrying...' : 'Getting a code...';
  fetch('/api/pair', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
      if (!d.ok || !d.code) {
        pairState = d.error || 'pair failed';
        if (isNetErr(d.error)) {
          setOffline(true);
          $('#pair-help').textContent = 'No internet. Retrying...';
          pairMintTimer = setTimeout(newPairCode, RETRY_MS);
          return;
        }
        $('#pair-help').textContent = d.error || 'Could not get a code. Check Diagnostics.';
        return;
      }
      setOffline(false);
      pairCode = d.code;
      pairCodeStore(pairCode);
      linkStore(d.token || '');
      pairState = 'code ' + pairCode;
      $('#pair-code').textContent = pairCode;
      $('#pair-help').textContent = 'Type this code in the GlassTube iPhone app.';
      updateHomePhoneHint();
      startPairPoll();
    })
    .catch(e => {
      pairState = netText(e).slice(0, 40);
      setOffline(true);
      $('#pair-help').textContent = 'No internet. Retrying...';
      pairMintTimer = setTimeout(newPairCode, RETRY_MS);
    });
}

function startPairPoll() {
  stopPairPoll();
  if (!pairCode) return;
  pollPair();
  pairTimer = setInterval(pollPair, PAIR_POLL_MS);
}

function stopPairPoll() {
  if (pairTimer) clearInterval(pairTimer);
  pairTimer = null;
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

function pollPair() {
  if (!pairKey()) return;
  fetch('/api/pair?code=' + encodeURIComponent(pairKey()))
    .then(r => r.json())
    .then(d => {
      if (!d.ok) {
        const dead = /expir|not active|not found|unknown/i.test(d.error || '');
        pairState = dead ? 'code expired' : (d.error || 'pair failed');
        if (current === 'phone') {
          $('#pair-help').textContent = dead
            ? 'That code expired. Getting a new one...'
            : (d.error || 'Could not reach pairing.');
        }
        if (!dead) return;
        stopPairPoll();
        pairCodeStore('');
        linkStore('');
        pairCode = '';
        updateHomePhoneHint();
        ensureListening();
        return;
      }
      setOffline(false);
      if (d.token && d.token !== pairLink) linkStore(d.token);
      if (d.code && d.code !== pairCode) {
        pairCode = d.code;
        pairCodeStore(pairCode);
        if (current === 'phone') $('#pair-code').textContent = pairCode;
      }
      pairState = (d.paired ? 'paired' : 'waiting') + ' · ' + pairCode;
      renderHome();
      pairPolls += 1;
      if (pairPolls % 8 === 0) {
        fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pairKey(), touch: true }),
        }).catch(() => {});
      }
      if (current === 'phone') {
        $('#pair-help').textContent = d.paired
          ? 'Phone connected. Send a video from the iPhone app. It starts here on any screen.'
          : 'Type this code in the GlassTube iPhone app.';
      }
      const dest = d.dest;
      const playable = dest && (dest.id || (dest.videos && dest.videos[0]));
      const special = dest && (dest.kind === 'channels' || dest.kind === 'channel' ||
        dest.kind === 'session');
      if (dest && (playable || special) && d.destSeq !== pairLastSeq) {
        pairLastSeq = d.destSeq;
        fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pairKey(), ack: d.destSeq }),
        }).catch(() => {});
        // A push older than a few minutes is a leftover from before this page
        // loaded. Ack it but never auto-play it, so a forgotten tab stays silent.
        const stale = playable && !special && dest.ts &&
          (Date.now() - Number(dest.ts) > PUSH_FRESH_MS);
        hudNote('push', { seq: d.destSeq, stale: !!stale,
          ageS: dest.ts ? Math.round((Date.now() - Number(dest.ts)) / 1000) : null,
          hasU: !!(dest.u || (dest.videos && dest.videos[0] && dest.videos[0].u)) });
        if (!stale) applyPush(dest);
      }
    })
    .catch(e => {
      pairState = netText(e).slice(0, 48);
      setOffline(true);
    });
}

/* Diagnostics the wearer can actually read back to someone. Every line is a
   fact about this device, not a guess: what the page origin really is (the
   embed routes die on a mismatch), whether the server can resolve a file from
   its own IP, and whether the phone has ever sent one. */
let selfTest = null;

function debugLines() {
  const errs = window.glasstubeErrors || [];
  const out = [];
  out.push(['App', 'v' + (window.GLASSTUBE_BUILD || '?')]);
  out.push(['Origin', String(window.location.origin || '?')]);
  out.push(['Viewport', window.innerWidth + 'x' + window.innerHeight]);
  out.push(['Online', navigator.onLine ? 'yes' : 'no', !!navigator.onLine]);
  out.push(['Phone pairing', pairState, pairState.indexOf('paired') === 0 ? true : undefined]);
  out.push(['Pair link', pairLink ? 'durable · survives restarts' : 'code only', !!pairLink]);
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

function renderDebug() {
  const rows = $('#debug-rows');
  rows.innerHTML = '';
  debugLines().forEach(function (row) {
    const d = document.createElement('div');
    if (row[2] === true) d.className = 'debug-ok';
    if (row[2] === false) d.className = 'debug-bad';
    d.textContent = row[0] + ': ' + row[1];
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

function handlePlayerKey(e) {
  const key = e.key;
  if (isBackKey(key) || key === DPAD.LEFT) {
    e.preventDefault();
    goBack();
    return;
  }
  if (key === DPAD.SELECT || key === ' ') {
    e.preventDefault();
    needGesture = false;
    if (typeof Player !== 'undefined') Player.toggle();
    setPlayGate(false);
    updateChrome();
    return;
  }
  if (key === DPAD.RIGHT) {
    e.preventDefault();
    if (typeof Player !== 'undefined') Player.seek(10);
    updateChrome();
    return;
  }
  if (key === DPAD.UP || key === 'Up' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (queue.length > 1) playPrev();
    else if (typeof Player !== 'undefined') Player.seek(-10);
    updateChrome();
    return;
  }
  if (key === DPAD.DOWN || key === 'Down' || e.code === 'ArrowDown') {
    e.preventDefault();
    playNext();
  }
}

function handleSearchKey(e) {
  const key = e.key;
  if (isBackKey(key)) {
    e.preventDefault();
    goBack();
    return;
  }
  if (key === DPAD.UP) { e.preventDefault(); moveKey(-1, 0); return; }
  if (key === DPAD.DOWN) { e.preventDefault(); moveKey(1, 0); return; }
  if (key === DPAD.LEFT) { e.preventDefault(); moveKey(0, -1); return; }
  if (key === DPAD.RIGHT) { e.preventDefault(); moveKey(0, 1); return; }
  if (key === DPAD.SELECT || key === ' ') { e.preventDefault(); pressKey(); return; }
  if (key === 'Backspace') { e.preventDefault(); typed = typed.slice(0, -1); renderSearch(); return; }
  // A real keyboard is attached when rehearsing on a computer. Let it type.
  if (key && key.length === 1 && typed.length < 60) {
    e.preventDefault();
    typed += key.toUpperCase();
    renderSearch();
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
  const r = resolveKey(e);
  if (!r) { inputStats.unknown++; return; }
  e.preventDefault();
  const now = Date.now();
  lastKeyAt = now;
  lastActiveAt = now;
  // Any resolved gesture is a user activation: let WP5's player unlock audio
  // on it synchronously, inside the gesture.
  if (typeof Player !== 'undefined' && typeof Player.unlock === 'function') {
    try { Player.unlock(); } catch (x) { /* unlock is best effort */ }
  }
  if (inputTest && current === 'debug') return;
  const name = r.name || ('char:' + r.char);
  if (r.name === 'enter' && e.repeat) { inputStats.repeat++; return; }
  if (!r.char && name === inputLast && now - inputLastAt < INPUT.DUP_MS) {
    inputStats.dup++;
    inputLastAt = now;
    return;
  }
  if (r.name === 'enter' && now - inputArrowAt < INPUT.ENTER_LOCK_MS) {
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
});

// "New code" is how you hand the glasses to a different phone, so it has to
// drop the durable link too, not just the six characters on screen.
$('#btn-pair-new').addEventListener('click', () => {
  stopPairPoll();
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
if (typeof Player !== 'undefined' && Player.preload) Player.preload();
sessionStore(sessionLoad());
renderSettings();
renderHome();
if (prefs && prefs.sleep()) armSleep();
ensureListening();

function hideSplash() {
  const splash = $('#splash');
  if (!splash || splash.classList.contains('splash-out')) return;
  splash.classList.add('splash-out');
  setTimeout(function () { splash.classList.add('hidden'); }, 700);
  focusFirst();
  if (window.glasstubeFitStage) window.glasstubeFitStage();
}

const splashIcon = document.querySelector('.splash-icon');
function holdThenHide() {
  setTimeout(hideSplash, 900);
}
if (splashIcon && splashIcon.complete && splashIcon.naturalWidth) holdThenHide();
else if (splashIcon) splashIcon.addEventListener('load', holdThenHide);
else holdThenHide();
setTimeout(hideSplash, 2600);
