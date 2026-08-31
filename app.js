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

const MAX_LIST = 6;
const CHANNEL_PAGE = 5;
const MAX_RECENTS = 12;
const PAIR_POLL_MS = 2000;
const RETRY_MS = 3000;
const PUSH_FRESH_MS = 10 * 60 * 1000;
const WAY_KEY = 'glasstube.way6';
const RECENTS_KEY = 'glasstube.recents';
const PAIR_KEY = 'glasstube.pair';
const PLAYLISTS_KEY = 'glasstube.playlists';
const PROGRESS_KEY = 'glasstube.progress';
const CHANNELS_KEY = 'glasstube.channels';
const sound = (typeof GlassSound !== 'undefined') ? GlassSound : null;
const prefs = (typeof GlassPrefs !== 'undefined') ? GlassPrefs : null;

const screens = {
  home: $('#screen-home'),
  list: $('#screen-list'),
  player: $('#screen-player'),
  phone: $('#screen-phone'),
  settings: $('#screen-settings'),
  debug: $('#screen-debug'),
};

let current = 'home';
let listBack = null;
let queue = [];
let queueIndex = -1;
let pairCode = '';
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
let wayChain = [0];
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

function show(name) {
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
  if (name !== 'player') focusFirst();
}

function focusables() {
  const scr = screens[current];
  if (!scr) return [];
  return Array.prototype.slice.call(
    scr.querySelectorAll('.focusable:not([disabled])')
  ).filter(el => el.offsetParent !== null);
}

function focusFirst() {
  const f = focusables();
  if (f.length) f[0].focus();
  else if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
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
}

function activateFocused() {
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('focusable')) return;
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
  if (!snap.duration || snap.time < 5) return;
  if (snap.duration - snap.time < 8) return;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      id: nowPlaying.id,
      title: nowPlaying.title,
      channel: nowPlaying.channel || '',
      thumb: nowPlaying.thumb || '',
      t: Math.floor(snap.time),
      queue: queue.slice(0, 20),
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
  if (sub) sub.textContent = (p.title || 'Video') + ' · ' + fmtTime(p.t);
}

function openContinue() {
  const p = progressLoad();
  if (!p) return;
  skipIds = {};
  if (p.queue && p.queue.length) {
    queue = p.queue.map(v => Object.assign({}, v, { _listTitle: p.listTitle || 'Continue' }));
    openPlayer(Math.min(p.queueIndex || 0, queue.length - 1), true, p.t);
  } else {
    queue = [Object.assign({}, p, { _listTitle: 'Continue' })];
    openPlayer(0, true, p.t);
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

function goBack() {
  if (current === 'list' && listBack) { listBack(); return; }
  if (current === 'player') {
    progressSave();
    if (typeof Player !== 'undefined') Player.destroy();
    nowPlaying = null;
    if (queue.length && queueTitle() !== 'From iPhone' && queueTitle() !== 'From phone') {
      showVideoList(queueTitle(), queue, listBack || (() => show('home')));
      return;
    }
    show('home');
    return;
  }
  if (current !== 'home') show('home');
}

function queueTitle() {
  return queue.length && queue[0] && queue[0]._listTitle
    ? queue[0]._listTitle
    : 'Videos';
}

function renderList(title, items, emptyText, onBack, backLabel, kind) {
  listKind = kind || '';
  listBack = onBack || (() => show('home'));
  $('#list-title').textContent = title;
  const box = $('#list-items');
  box.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('div');
    p.className = 'empty-msg';
    p.textContent = emptyText || 'Nothing here yet.';
    box.appendChild(p);
  } else {
    items.slice(0, MAX_LIST + 1).forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'focusable list-btn';
      if (item.thumb) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = item.thumb;
        btn.appendChild(img);
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
  const back = $('#list-back');
  back.innerHTML = '';
  const b = document.createElement('button');
  b.className = 'focusable back-btn';
  b.innerHTML = (backLabel || 'Back') + ' <span class="back-hint">swipe left</span>';
  b.addEventListener('click', listBack);
  back.appendChild(b);
  show('list');
}

function showVideoList(title, videos, onBack) {
  skipIds = {};
  queue = videos.map(v => Object.assign({}, v, { _listTitle: title }));
  const items = [];
  if (videos.length > 1) {
    items.push({
      label: 'Play all',
      sub: videos.length + ' videos, then the next one starts itself',
      onPick: () => {
        queue = maybeShuffle(queue);
        openPlayer(0, true);
      },
    });
  }
  videos.forEach((v, i) => {
    items.push({
      label: v.title,
      sub: v.channel || '',
      thumb: v.thumb,
      onPick: () => openPlayer(i, true),
    });
  });
  renderList(title, items, 'No videos in this list.', onBack || (() => show('home')));
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

function isDeadVideo(code) {
  return code === 2 || code === 100;
}

function wayCount() {
  return (typeof Player !== 'undefined' && Player.ways) ? Player.ways() : 5;
}

function savedWay() {
  try {
    const n = Number(localStorage.getItem(WAY_KEY));
    return (n >= 0 && n < wayCount()) ? n : 0;
  } catch (e) { return 0; }
}

function rememberWay(n) {
  if (n !== 0) return;
  try { localStorage.setItem(WAY_KEY, String(n)); } catch (e) { /* private mode */ }
}

function buildWayChain() {
  const n = wayCount();
  const chain = [];
  for (let i = 0; i < n; i++) chain.push(i);
  return chain;
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
  const s = Player.lastStrategy ? Player.lastStrategy() : 0;
  playFails.unshift(id + ' · code ' + (code || '?') + ' · way ' + s + ' · ' + (err || 'unknown'));
  playFails = playFails.slice(0, 10);
  diagSend('fail', { id: id, code: code || 0, way: s, err: String(err || '').slice(0, 120) });
}

function blockedText(code, err) {
  if (/playable file/i.test(String(err || ''))) {
    return 'The phone could not get a playable file. Stay on the Phone tab, use WiFi, and send again.';
  }
  if (/HTML5 media 4/i.test(String(err || ''))) {
    return String(err) + '. Put the phone and the glasses on the same WiFi, then send again.';
  }
  if (/HTML5 media/i.test(String(err || ''))) {
    return String(err) + '. The glasses could not play the file the phone sent.';
  }
  if (code === 100) return 'That video is gone or private.';
  if (code === 2) return 'That video link is broken.';
  if (code === 7 || code === 5) {
    return 'YouTube blocked this phone from fetching the video. Stay on the Phone tab, use WiFi, and send again. Raw: ' + (err || ('code ' + code));
  }
  return 'YouTube refused to play this video here (error ' + (code || '?') + '). ' + (err || '');
}

function skipUnplayable(err, code) {
  playFailNote(err, code);
  if (nowPlaying && nowPlaying.id) skipIds[nowPlaying.id] = true;
  for (let i = 1; i <= queue.length; i++) {
    const idx = (queueIndex + i) % queue.length;
    const v = queue[idx];
    if (v && v.id && !skipIds[v.id]) {
      setStatus('Skipped one video YouTube would not play.', false);
      openPlayer(idx, true);
      return;
    }
  }
  setLoading(false);
  setPlayGate(false);
  blockedFor = (nowPlaying && nowPlaying.id) || '';
  $('#player-error').textContent = queue.length > 1
    ? 'No video in this list would play. ' + blockedText(code, err)
    : blockedText(code, err);
  $('#player-error').classList.remove('hidden');
}

/* Quietly move to the next embed strategy for this video. Returns true when
   another attempt is coming, false when the chain is exhausted. */
function tryNextWay(videoId, err, code) {
  if (!videoId || isDeadVideo(code) || wayFor !== videoId) return false;
  if (loadRetry) return true;
  if (wayPos + 1 >= wayChain.length) return false;
  playFailNote(err, code);
  wayPos += 1;
  loadRetry = setTimeout(function () {
    loadRetry = 0;
    if (current === 'player' && nowPlaying && nowPlaying.id === videoId) {
      openPlayer(queueIndex, true, 0, { retry: true });
    }
  }, 600 + wayPos * 300);
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
    wayChain = buildWayChain();
    wayPos = 0;
    wayFor = video.id;
  }
  if (blockedFor && blockedFor !== video.id) blockedFor = '';
  nowPlaying = video;
  recentsAdd(video);
  $('#player-title').textContent = video.title || 'YouTube video';
  $('#player-channel').textContent = video.channel || '';
  $('#player-error').classList.add('hidden');
  $('#player-time').textContent = '0:00 / 0:00';
  $('#player-fill').style.width = '0%';
  needGesture = false;
  setPlayGate(false);
  setLoading(true, video.title, 'Loading...');
  show('player');
  if (typeof Player === 'undefined') {
    $('#player-error').textContent = 'Player script missing.';
    $('#player-error').classList.remove('hidden');
    return;
  }
  const attempt = wayPos;
  Player.setHandlers(playNext, updateChrome);
  Player.load(video, autoplay, startAt || 0, wayChain[wayPos] || 0).then(function (ok) {
    if (!ok) {
      const err = Player.lastError() || 'Could not start YouTube.';
      const code = Player.lastCode ? Player.lastCode() : 0;
      if (!tryNextWay(video.id, err, code)) skipUnplayable(err, code);
    } else {
      setOffline(false);
    }
    updateChrome();
    if (autoplay) {
      setTimeout(function () {
        if (current !== 'player') return;
        if (nowPlaying && nowPlaying.id !== video.id) return;
        if (wayPos !== attempt) return;
        const snap = Player.snapshot();
        if (snap.playing || snap.paused || snap.error) return;
        needGesture = true;
        setPlayGate(true, video.title, 'Enter to play');
        updateChrome();
      }, 2800);
      setTimeout(function () {
        if (current !== 'player') return;
        if (nowPlaying && nowPlaying.id !== video.id) return;
        if (wayPos !== attempt) return;
        const snap = Player.snapshot();
        if (snap.playing || snap.paused || snap.ended || snap.error) return;
        if (snap.time > 0.4) return;
        if (!tryNextWay(video.id, 'player stalled', 0) && !needGesture) {
          skipUnplayable('player stalled', 0);
        }
      }, 12000);
    }
  });
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

function applyPush(dest) {
  if (!dest) return;
  if (dest.kind === 'channels') {
    channelsSave(dest.channels || []);
    if (listKind === 'channels' && current === 'list') openChannels(channelPage);
    if (current !== 'player') setStatus('Channels updated from your phone.');
    return;
  }
  if (dest.kind === 'channel' && dest.id) {
    loadChannel({ id: dest.id, name: dest.name || 'Channel' });
    return;
  }
  const list = (dest.videos && dest.videos.length) ? dest.videos : [dest];
  const name = dest.playlist || 'From iPhone';
  skipIds = {};
  if (dest.u) {
    list.forEach(function (v) {
      if (v && !v.u && (!dest.id || v.id === dest.id)) v.u = dest.u;
    });
    if (list[0] && !list[0].u) list[0].u = dest.u;
  }
  const firstU = (list[0] && list[0].u) || dest.u || '';
  if (/^http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d+\//.test(firstU)) {
    location.replace(firstU.replace('/s/', '/p/'));
    return;
  }
  const ordered = maybeShuffle(list);
  queue = ordered.map(v => Object.assign({}, v, { _listTitle: name }));
  playlistRemember(name, list);
  diagSend('push', {
    id: (queue[0] && queue[0].id) || '',
    hasU: !!(queue[0] && queue[0].u),
    origin: String(window.location.origin || ''),
  });
  openPlayer(0, true);
  setStatus(list.length > 1
    ? 'Playing ' + name + ' · ' + list.length + ' videos.'
    : 'Playing from your phone.');
}

function updateChrome() {
  if (current !== 'player' || typeof Player === 'undefined') return;
  const snap = Player.snapshot();
  $('#player-time').textContent = fmtTime(snap.time) + ' / ' + fmtTime(snap.duration);
  const pct = snap.duration ? Math.min(100, (snap.time / snap.duration) * 100) : 0;
  $('#player-fill').style.width = pct + '%';
  const pos = queue.length > 1 ? ((queueIndex + 1) + '/' + queue.length + ' · ') : '';
  const nxt = queue[queueIndex + 1] || (prefs && prefs.repeat() === 'all' ? queue[0] : null);
  const nextBit = (queue.length > 1 && nxt && nxt.title)
    ? (' · Next ' + String(nxt.title).slice(0, 28))
    : '';
  let phase = 'Loading';
  if (snap.playing) phase = 'Enter pause';
  else if (snap.error && nowPlaying && blockedFor === nowPlaying.id) phase = 'Blocked by YouTube';
  else if (snap.error) phase = 'Starting';
  else if (snap.paused) phase = 'Paused · Enter play';
  else if (snap.ended) phase = 'Ended · Enter play';
  else if (needGesture) phase = 'Enter to play';
  else if (snap.buffering) phase = 'Buffering';
  $('#player-hint').textContent = pos +
    phase +
    (queue.length > 1 ? ' · Up last · Down next' : ' · Up -10s') +
    ' · Left back · Right +10s' + nextBit;
  if ($('#player-next')) {
    $('#player-next').textContent = nxt && nxt.title && queue.length > 1
      ? ('Next: ' + nxt.title)
      : '';
  }
  const title = nowPlaying && nowPlaying.title;
  if (snap.playing) {
    needGesture = false;
    setLoading(false);
    setPlayGate(false);
    $('#player-error').textContent = '';
    $('#player-error').classList.add('hidden');
    const bar = $('#errbar');
    if (bar) {
      bar.textContent = '';
      bar.classList.add('hidden');
    }
    if (loadRetry) {
      clearTimeout(loadRetry);
      loadRetry = 0;
    }
    if (Player.lastStrategy) rememberWay(Player.lastStrategy());
    progressSave();
  } else if (snap.error) {
    needGesture = false;
    const id = nowPlaying && nowPlaying.id;
    const code = Player.lastCode ? Player.lastCode() : 0;
    if (id && blockedFor === id) {
      setLoading(false);
      setPlayGate(false);
      return;
    }
    if (id && tryNextWay(id, snap.error, code)) {
      setLoading(true, title, 'Loading...');
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

function openRecents() {
  const list = recentsLoad();
  if (!list.length) {
    renderList('Recents', [], 'Nothing played yet. Open Channels, or send a link from your phone.', () => show('home'));
    return;
  }
  showVideoList('Recents', list, () => show('home'));
}

function openPlaylists() {
  const lists = playlistsLoad();
  renderList('Playlists', lists.map(p => ({
    label: p.name,
    sub: (p.videos || []).length + ' videos',
    onPick: () => {
      skipIds = {};
      const vids = maybeShuffle(p.videos || []);
      queue = vids.map(v => Object.assign({}, v, { _listTitle: p.name }));
      if (!queue.length) return;
      openPlayer(0, true);
    },
  })), 'Send a playlist from your iPhone. It stays here after that.', () => show('home'));
}

function openChannels(page) {
  channelPage = Math.max(0, Number(page) || 0);
  const all = channelsLoad();
  const start = channelPage * CHANNEL_PAGE;
  const slice = all.slice(start, start + CHANNEL_PAGE);
  const items = slice.map(ch => ({
    label: ch.name,
    sub: 'Latest videos',
    onPick: () => loadChannel(ch),
  }));
  if (start + CHANNEL_PAGE < all.length) {
    items.push({
      label: 'More channels',
      sub: (all.length - start - CHANNEL_PAGE) + ' more',
      onPick: () => openChannels(channelPage + 1),
    });
  } else if (channelPage > 0) {
    items.push({
      label: 'First page',
      sub: all.length + ' channels',
      onPick: () => openChannels(0),
    });
  }
  renderList(
    'Channels',
    items,
    'Add channels on your iPhone. They show up here.',
    () => {
      if (channelPage > 0) openChannels(channelPage - 1);
      else show('home');
    },
    channelPage > 0 ? 'Previous' : 'Back',
    'channels'
  );
}

function loadChannel(ch) {
  feedWait = ch.id;
  setStatus('Loading ' + ch.name + '...');
  function attempt() {
    if (feedWait !== ch.id) return;
    fetch('/api/feed?channel=' + encodeURIComponent(ch.id))
      .then(r => r.json())
      .then(d => {
        if (feedWait !== ch.id) return;
        if (!d.ok) {
          feedHealth = d.error || 'feed failed';
          if (isNetErr(d.error)) {
            setOffline(true);
            setTimeout(attempt, RETRY_MS);
            return;
          }
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
        showVideoList(ch.name, videos, () => openChannels(channelPage));
      })
      .catch(e => {
        feedHealth = String((e && e.message) || e);
        setOffline(true);
        setTimeout(attempt, RETRY_MS);
      });
  }
  attempt();
}

function openPhone() {
  show('phone');
  pairCode = pairCodeStored();
  if (pairCode) {
    $('#pair-code').textContent = pairCode;
    $('#pair-help').textContent = 'Type this code in the GlassTube iPhone app.';
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

function pollPair() {
  if (!pairCode) return;
  fetch('/api/pair?code=' + encodeURIComponent(pairCode))
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
        pairCode = '';
        updateHomePhoneHint();
        ensureListening();
        return;
      }
      setOffline(false);
      pairState = (d.paired ? 'paired' : 'waiting') + ' · ' + pairCode;
      updateHomePhoneHint();
      pairPolls += 1;
      if (pairPolls % 8 === 0) {
        fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pairCode, touch: true }),
        }).catch(() => {});
      }
      if (current === 'phone') {
        $('#pair-help').textContent = d.paired
          ? 'Phone connected. Send a video from the iPhone app. It starts here on any screen.'
          : 'Type this code in the GlassTube iPhone app.';
      }
      const dest = d.dest;
      const playable = dest && (dest.id || (dest.videos && dest.videos[0]));
      const special = dest && (dest.kind === 'channels' || dest.kind === 'channel');
      if (dest && (playable || special) && d.destSeq !== pairLastSeq) {
        pairLastSeq = d.destSeq;
        fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pairCode, ack: d.destSeq }),
        }).catch(() => {});
        // A push older than a few minutes is a leftover from before this page
        // loaded. Ack it but never auto-play it, so a forgotten tab stays silent.
        const stale = playable && !special && dest.ts &&
          (Date.now() - Number(dest.ts) > PUSH_FRESH_MS);
        if (!stale) applyPush(dest);
      }
    })
    .catch(e => {
      pairState = netText(e).slice(0, 48);
      setOffline(true);
    });
}

function renderDebug() {
  const rows = $('#debug-rows');
  rows.innerHTML = '';
  function line(label, value, ok) {
    const d = document.createElement('div');
    if (ok === true) d.className = 'debug-ok';
    if (ok === false) d.className = 'debug-bad';
    d.textContent = label + ': ' + value;
    rows.appendChild(d);
  }
  line('Viewport', window.innerWidth + 'x' + window.innerHeight);
  line('YouTube API', (window.YT && window.YT.Player) ? 'loaded' : 'not loaded yet', !!(window.YT && window.YT.Player));
  line('Phone pairing', pairState, pairState.indexOf('paired') === 0 ? true : undefined);
  line('Channel feeds', feedHealth);
  line('Recents', String(recentsLoad().length));
  line('Playlists', String(playlistsLoad().length));
  line('Sound', (sound && sound.enabled()) ? 'on' : 'off');
  line('Captions', prefs && prefs.captions() ? 'on' : 'off');
  line('Speed', prefs ? prefs.speedLabel() : '1x');
  line('Repeat', prefs ? prefs.repeatLabel() : 'all');
  line('Sleep', prefs ? prefs.sleepLabel() : 'off');
  line('Now playing', nowPlaying ? nowPlaying.title : 'none');
  const errs = window.glasstubeErrors || [];
  line('JS errors', errs.length ? errs[errs.length - 1] : 'none', errs.length ? false : true);
  line('Playback fails', playFails.length ? playFails[0] : 'none', playFails.length ? false : true);
  if (playFails.length > 1) line('Earlier fail', playFails[1], false);
  const dump = [
    'ua=' + navigator.userAgent,
    'pair=' + (pairCode || ''),
    'now=' + ((nowPlaying && nowPlaying.id) || ''),
    'lastError=' + ((typeof Player !== 'undefined' && Player.lastError) ? Player.lastError() : ''),
    'lastCode=' + ((typeof Player !== 'undefined' && Player.lastCode) ? Player.lastCode() : ''),
    'fails:',
    playFails.length ? playFails.join('\n') : 'none',
    'js:',
    errs.length ? errs.join('\n') : 'none',
  ].join('\n');
  const logEl = $('#debug-log');
  if (logEl) logEl.value = dump;
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

document.addEventListener('keydown', function (e) {
  if (current === 'player') {
    handlePlayerKey(e);
    return;
  }
  const key = e.key;
  if (isBackKey(key)) {
    e.preventDefault();
    goBack();
    return;
  }
  if (key === DPAD.LEFT) {
    e.preventDefault();
    if (current === 'home') moveFocus('up');
    else goBack();
    return;
  }
  if (key === DPAD.UP) { e.preventDefault(); moveFocus('up'); return; }
  if (key === DPAD.DOWN) { e.preventDefault(); moveFocus('down'); return; }
  if (key === DPAD.RIGHT) { e.preventDefault(); moveFocus('down'); return; }
  if (key === DPAD.SELECT) { e.preventDefault(); activateFocused(); }
}, true);

document.querySelectorAll('#screen-home [data-menu]').forEach(btn => {
  btn.addEventListener('click', () => {
    const menu = btn.getAttribute('data-menu');
    if (menu === 'recents') openRecents();
    if (menu === 'channels') openChannels();
    if (menu === 'playlists') openPlaylists();
    if (menu === 'phone') openPhone();
    if (menu === 'continue') openContinue();
    if (menu === 'settings') { renderSettings(); show('settings'); }
    if (menu === 'debug') { renderDebug(); show('debug'); }
  });
});

window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => {
  setOffline(false);
  if (!pairCode) ensureListening();
});

$('#btn-phone-back').addEventListener('click', () => show('home'));
$('#btn-pair-new').addEventListener('click', () => {
  stopPairPoll();
  pairCode = '';
  pairLastSeq = -1;
  pairCodeStore('');
  newPairCode();
});
$('#btn-debug-back').addEventListener('click', () => show('home'));
$('#btn-settings-back').addEventListener('click', () => show('home'));
$('#btn-retest').addEventListener('click', renderDebug);
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
  if (pairCode) {
    startPairPoll();
    updateHomePhoneHint();
    return;
  }
  newPairCode();
}

if (typeof Player !== 'undefined' && Player.preload) Player.preload();
renderSettings();
renderContinue();
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
