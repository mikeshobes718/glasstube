/* Playback for the glasses HUD.

   Nothing here ever takes focus. The Neural Band sends arrow keys and Enter to
   whatever the document thinks is focused, so an iframe that grabs focus eats
   every gesture and the HUD goes dead. Every frame is tabindex="-1" with
   pointer events off, and holdFocus() pulls focus back on a timer.

   Four routes, tried in order, best first:

     file   <video> on the googlevideo file the phone resolved and pushed.
            HTTPS, plays inline, survives the phone sleeping. Google signs the
            resolving IP into the URL, so this works while the glasses and the
            phone share a public IP - which is what "same WiFi" means.
     proxy  <video> on /api/watch, which resolves and streams from Vercel.
            Free of the phone entirely, but YouTube answers datacenter IPs with
            LOGIN_REQUIRED for most videos, so treat it as a bonus not a plan.
     embed  /embed.html, a same-origin page that builds the YouTube IFrame API
            player at parse time and bridges it over postMessage.
     go     /api/watch?go=1, a 302 into youtube.com/embed so YouTube itself is
            the frame document and the redirect supplies the referrer.

   What is deliberately NOT here: calling YouTube's InnerTube API from this
   page. A browser always sends Origin on a cross-origin POST, and YouTube
   answers any Origin that is not its own with 403. It cannot be made to work
   from the HUD, so the old askClientStream() is gone rather than retried. */
const Player = (() => {
  const ROUTES = ['file', 'proxy', 'embed', 'go'];

  let yt = null;
  let html5 = null;
  let raw = null;
  let rawMsg = null;
  let bridge = null;
  let bridgeMsgHandler = null;
  let tick = 0;
  let playRetry = 0;
  let ignoreEnded = false;
  let lastError = '';
  let lastErrorCode = 0;
  let lastRoute = 'file';
  let holdPause = false;
  let hasPlayed = false;
  let onEnded = null;
  let onChange = null;
  let session = '';

  const poster = () => document.getElementById('yt-poster');

  function hidePoster() {
    const el = poster();
    if (el) el.classList.add('hidden');
  }

  function showPoster(url) {
    const el = poster();
    if (!el) return;
    if (url) el.src = url;
    el.classList.remove('hidden');
  }

  function soundOn() {
    return !(window.GlassSound && !window.GlassSound.enabled());
  }

  function prefs() {
    return window.GlassPrefs || null;
  }

  function setSession(token) {
    session = String(token || '');
  }

  function ytErrorText(code) {
    const map = {
      2: 'Bad video id.',
      5: 'HTML5 player error.',
      100: 'Video not found.',
      101: 'YouTube blocked embedding.',
      150: 'YouTube blocked embedding.',
      153: 'YouTube blocked the embed.',
    };
    return map[code] || ('YouTube error ' + code);
  }

  function isMediaUrl(u) {
    u = String(u || '');
    return /^https:\/\/[a-z0-9.-]*googlevideo\.com\//i.test(u) &&
      /videoplayback/i.test(u) &&
      /[?&]itag=(18|22)(?:&|$)/.test(u) &&
      u.length >= 100;
  }

  /* Only offer routes that could actually run for this video. Trying "file"
     with no file just burns the retry budget before the routes that can. */
  function routesFor(video) {
    const list = [];
    if (isMediaUrl(video && video.u) || hasNativeHook()) list.push('file');
    list.push('proxy', 'embed', 'go');
    return list;
  }

  function hasNativeHook() {
    return !!(window.webkit && window.webkit.messageHandlers &&
      window.webkit.messageHandlers.glasstube);
  }

  function proxyUrl(id) {
    const q = 'v=' + encodeURIComponent(id) + (session ? '&s=' + encodeURIComponent(session) : '');
    return '/api/watch?' + q;
  }

  function bridgeSend(msg) {
    if (!bridge || !bridge.iframe || !bridge.iframe.contentWindow) return;
    try {
      bridge.iframe.contentWindow.postMessage(
        Object.assign({ glasstubeCmd: 1 }, msg),
        window.location.origin
      );
    } catch (e) { /* frame gone */ }
  }

  function rawSend(func, args) {
    if (!raw || !raw.iframe || !raw.iframe.contentWindow) return;
    try {
      raw.iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: func,
        args: args || [],
      }), '*');
    } catch (e) { /* frame gone */ }
  }

  function applySound(on) {
    const want = on !== undefined ? !!on : soundOn();
    if (html5) {
      html5.muted = !want;
      return;
    }
    if (raw) {
      rawSend(want ? 'unMute' : 'mute');
      return;
    }
    if (bridge) {
      bridgeSend({ cmd: want ? 'unmute' : 'mute' });
      return;
    }
    if (!yt) return;
    try {
      if (want) yt.unMute();
      else yt.mute();
    } catch (e) { /* player not ready */ }
  }

  function applyCaptions() {
    const on = !!(prefs() && prefs().captions());
    if (html5 || raw) return;
    if (bridge) {
      bridgeSend({ cmd: 'captions', on: on });
      return;
    }
    if (!yt) return;
    try {
      if (on) {
        yt.loadModule('captions');
        yt.setOption('captions', 'track', { languageCode: 'en' });
      } else {
        yt.unloadModule('captions');
      }
    } catch (e) { /* captions not available */ }
  }

  function applyRate() {
    const n = prefs() ? prefs().speed() : 1;
    if (html5) {
      try { html5.playbackRate = n; } catch (e) { /* ignored */ }
      return;
    }
    if (raw) {
      rawSend('setPlaybackRate', [n]);
      return;
    }
    if (bridge) {
      bridgeSend({ cmd: 'rate', r: n });
      return;
    }
    if (!yt) return;
    try { yt.setPlaybackRate(n); } catch (e) { /* ignored */ }
  }

  function applyPicture() {
    const wrap = document.getElementById('yt-wrap');
    if (!wrap) return;
    wrap.classList.toggle('audio-only', !!(prefs() && prefs().audioOnly()));
  }

  function applyAll() {
    applySound();
    applyCaptions();
    applyRate();
    applyPicture();
  }

  function tryPlay(forceMuteFirst) {
    if (html5) {
      html5.muted = !!(forceMuteFirst || !soundOn());
      const p = html5.play();
      if (p && p.catch) p.catch(function () { /* gesture may be required */ });
      return;
    }
    if (raw) {
      if (forceMuteFirst || !soundOn()) rawSend('mute');
      else rawSend('unMute');
      rawSend('playVideo');
      return;
    }
    if (bridge) {
      if (forceMuteFirst || !soundOn()) bridgeSend({ cmd: 'mute' });
      else bridgeSend({ cmd: 'unmute' });
      bridgeSend({ cmd: 'play' });
      return;
    }
    if (!yt) return;
    try {
      if (forceMuteFirst || !soundOn()) yt.mute();
      else yt.unMute();
      yt.playVideo();
    } catch (e) { /* gesture may be required */ }
  }

  function ensureApi() {
    return new Promise(resolve => {
      if (window.YT && window.YT.Player) {
        resolve(true);
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        resolve(true);
      };
      if (!document.getElementById('yt-iframe-api')) {
        const s = document.createElement('script');
        s.id = 'yt-iframe-api';
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
      }
      setTimeout(function () {
        resolve(!!(window.YT && window.YT.Player));
      }, 8000);
    });
  }

  function mountHost() {
    const slot = document.getElementById('yt-slot');
    if (!slot) return null;
    slot.innerHTML = '<div id="yt-host"></div>';
    return document.getElementById('yt-host');
  }

  function hostFrame() {
    const slot = document.getElementById('yt-slot');
    if (!slot) return null;
    let iframe = document.getElementById('yt-host');
    if (iframe && iframe.tagName === 'IFRAME') return iframe;
    slot.innerHTML = '';
    iframe = document.createElement('iframe');
    iframe.id = 'yt-host';
    iframe.width = '600';
    iframe.height = '338';
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.pointerEvents = 'none';
    slot.appendChild(iframe);
    return iframe;
  }

  function resetSoft() {
    ignoreEnded = true;
    if (tick) {
      clearInterval(tick);
      tick = 0;
    }
    playRetry = 0;
    if (bridgeMsgHandler) {
      window.removeEventListener('message', bridgeMsgHandler);
      bridgeMsgHandler = null;
    }
    bridge = null;
    if (rawMsg) {
      window.removeEventListener('message', rawMsg);
      rawMsg = null;
    }
    raw = null;
    if (html5) {
      try { html5.pause(); html5.removeAttribute('src'); html5.load(); } catch (e) { /* ignored */ }
    }
    html5 = null;
    if (yt) {
      try { yt.destroy(); } catch (e) { /* already gone */ }
      yt = null;
    }
  }

  function destroy() {
    resetSoft();
    mountHost();
  }

  function lockIframe() {
    const iframe = (yt && yt.getIframe && yt.getIframe()) ||
      document.querySelector('#yt-slot iframe');
    if (!iframe) return;
    iframe.setAttribute('tabindex', '-1');
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  }

  function holdFocus() {
    try {
      lockIframe();
      const active = document.activeElement;
      if (active && active.tagName === 'IFRAME') active.blur();
      if (window.focus) window.focus();
    } catch (e) { /* cross-origin iframe */ }
  }

  function startTick(autoplay) {
    tick = setInterval(function () {
      holdFocus();
      const s = state();
      if (autoplay && !hasPlayed && !holdPause && s !== 1 && s !== 0 && !lastError && playRetry < 8) {
        playRetry += 1;
        tryPlay(playRetry < 4);
        if (playRetry >= 4 && soundOn()) applySound(true);
      }
      if (typeof onChange === 'function') onChange('tick');
    }, 400);
  }

  function markPlaying() {
    hasPlayed = true;
    holdPause = false;
    lastError = '';
    lastErrorCode = 0;
    if (!(prefs() && prefs().audioOnly())) hidePoster();
  }

  function listenBridge(iframe) {
    bridge = { iframe: iframe, st: { s: -1, t: 0, d: 0 } };
    bridgeMsgHandler = function (ev) {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data || {};
      if (!d.glasstubeEmbed || !bridge) return;
      if (d.type === 'ready') {
        lockIframe();
        applyAll();
        return;
      }
      if (d.type === 'time') {
        bridge.st.t = Number(d.t) || 0;
        bridge.st.d = Number(d.d) || 0;
        if (d.s !== undefined) bridge.st.s = d.s;
        return;
      }
      if (d.type === 'state') {
        bridge.st.s = d.state;
        if (d.state === 1) {
          markPlaying();
          applySound();
        }
        if (d.state === 2) holdPause = true;
        if (d.state === 0 && !ignoreEnded && typeof onEnded === 'function') onEnded();
        if (typeof onChange === 'function') onChange(d.state);
        return;
      }
      if (d.type === 'error') {
        lastErrorCode = Number(d.code) || 0;
        lastError = ytErrorText(d.code);
        if (typeof onChange === 'function') onChange('error');
      }
    };
    window.addEventListener('message', bridgeMsgHandler);
  }

  function loadEmbed(video, autoplay, startAt) {
    const iframe = hostFrame();
    if (!iframe) return Promise.resolve(false);
    const params = new URLSearchParams({
      v: video.id,
      autoplay: autoplay ? '1' : '0',
      start: String(Math.floor(startAt || 0)),
    });
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.src = '/embed.html?' + params.toString();
    listenBridge(iframe);
    ignoreEnded = false;
    lockIframe();
    applyPicture();
    startTick(autoplay);
    return Promise.resolve(true);
  }

  function listenRaw(iframe, autoplay, startAt) {
    raw = { iframe: iframe, st: { s: -1, t: 0, d: 0 } };
    rawMsg = function (ev) {
      if (!raw || ev.source !== iframe.contentWindow) return;
      let data = ev.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (err) { return; }
      }
      if (!data || typeof data !== 'object') return;
      const evName = String(data.event || '');
      const info = data.info;
      if (evName === 'onReady' || evName === 'initialDelivery') {
        rawSend('addEventListener', ['onStateChange']);
        rawSend('addEventListener', ['onError']);
        applyAll();
        if (startAt && startAt > 3) rawSend('seekTo', [startAt, true]);
        if (autoplay) tryPlay(true);
        return;
      }
      if (evName === 'onError') {
        lastErrorCode = Number(info != null ? info : data.data) || 0;
        lastError = ytErrorText(lastErrorCode);
        if (typeof onChange === 'function') onChange('error');
        return;
      }
      if (evName === 'onStateChange') {
        const s = Number(info != null ? info : data.data);
        raw.st.s = s;
        if (s === 1) {
          markPlaying();
          applySound();
        }
        if (s === 2) holdPause = true;
        if (s === 0 && !ignoreEnded && typeof onEnded === 'function') onEnded();
        if (typeof onChange === 'function') onChange(s);
        return;
      }
      if (evName === 'infoDelivery' && info && typeof info === 'object') {
        if (info.currentTime != null) raw.st.t = Number(info.currentTime) || 0;
        if (info.duration != null) raw.st.d = Number(info.duration) || 0;
        if (info.playerState != null) raw.st.s = Number(info.playerState);
        if (raw.st.s === 1) markPlaying();
      }
    };
    window.addEventListener('message', rawMsg);
  }

  function loadGo(video, autoplay, startAt) {
    const slot = document.getElementById('yt-slot');
    if (!slot) return Promise.resolve(false);
    slot.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.id = 'yt-host';
    iframe.width = '600';
    iframe.height = '338';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('tabindex', '-1');
    iframe.style.pointerEvents = 'none';
    const params = new URLSearchParams({
      v: video.id,
      go: '1',
      autoplay: autoplay ? '1' : '0',
      start: String(Math.floor(startAt || 0)),
    });
    listenRaw(iframe, autoplay, startAt);
    ignoreEnded = false;
    applyPicture();
    iframe.addEventListener('load', function () {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'listening',
          id: 'yt-host',
        }), '*');
      } catch (e) { /* cross-origin until YouTube loads */ }
      setTimeout(function () {
        if (startAt && startAt > 3) rawSend('seekTo', [startAt, true]);
        if (autoplay) tryPlay(true);
      }, 500);
    });
    iframe.src = '/api/watch?' + params.toString();
    slot.appendChild(iframe);
    startTick(autoplay);
    return Promise.resolve(true);
  }

  /* The iOS wrapper can resolve a file itself when the HUD runs in its Glasses
     tab. On the real glasses this handler does not exist and we skip straight
     through. */
  function askNativeStream(id) {
    return new Promise(function (resolve) {
      if (!hasNativeHook()) {
        resolve(null);
        return;
      }
      let done = false;
      function finish(url) {
        if (done) return;
        done = true;
        window.removeEventListener('glasstubeStream', onEvt);
        resolve(url || null);
      }
      function onEvt(e) {
        const d = e && e.detail;
        finish(d && d.u ? String(d.u) : '');
      }
      window.addEventListener('glasstubeStream', onEvt);
      setTimeout(function () { finish(''); }, 5000);
      try { window.webkit.messageHandlers.glasstube.postMessage({ type: 'stream', id: id }); }
      catch (e) { finish(''); }
    }).then(function (url) {
      return isMediaUrl(url) ? url : null;
    });
  }

  function fileSrc(video) {
    if (isMediaUrl(video && video.u)) return Promise.resolve(video.u);
    return askNativeStream(video.id);
  }

  function mountVideo(src, video, autoplay, startAt) {
    const slot = document.getElementById('yt-slot');
    if (!slot) return false;
    slot.innerHTML = '';
    const v = document.createElement('video');
    v.id = 'yt-host';
    v.setAttribute('playsinline', 'true');
    v.setAttribute('webkit-playsinline', 'true');
    v.setAttribute('referrerpolicy', 'no-referrer');
    v.setAttribute('disablepictureinpicture', '');
    v.muted = true;
    v.preload = 'auto';
    v.controls = false;
    v.src = src;
    v.addEventListener('playing', function () {
      markPlaying();
      applySound();
      applyRate();
      if (typeof onChange === 'function') onChange(1);
    });
    v.addEventListener('pause', function () {
      if (!v.ended) holdPause = true;
      if (typeof onChange === 'function') onChange(2);
    });
    v.addEventListener('ended', function () {
      if (!ignoreEnded && typeof onEnded === 'function') onEnded();
    });
    v.addEventListener('waiting', function () {
      if (typeof onChange === 'function') onChange(3);
    });
    v.addEventListener('error', function () {
      const media = v.error;
      const mediaCode = (media && media.code) || 0;
      lastErrorCode = 5;
      lastError = 'Media error ' + (mediaCode || '?') + ' on ' + lastRoute;
      if (typeof onChange === 'function') onChange('error');
    });
    if (startAt && startAt > 3) {
      v.addEventListener('loadedmetadata', function once() {
        v.removeEventListener('loadedmetadata', once);
        try { v.currentTime = startAt; } catch (e) { /* ignored */ }
      });
    }
    slot.appendChild(v);
    html5 = v;
    ignoreEnded = false;
    applyPicture();
    if (autoplay) tryPlay(true);
    startTick(autoplay);
    return true;
  }

  function loadFile(video, autoplay, startAt) {
    return fileSrc(video).then(function (src) {
      if (!src) {
        lastError = 'No file from the phone for this video.';
        lastErrorCode = 0;
        return false;
      }
      return mountVideo(src, video, autoplay, startAt);
    });
  }

  function loadProxy(video, autoplay, startAt) {
    if (!video || !video.id) {
      lastError = 'No video id.';
      return Promise.resolve(false);
    }
    return Promise.resolve(mountVideo(proxyUrl(video.id), video, autoplay, startAt));
  }

  function load(video, autoplay, startAt, route) {
    lastError = '';
    lastErrorCode = 0;
    holdPause = false;
    hasPlayed = false;
    lastRoute = ROUTES.indexOf(route) >= 0 ? route : 'file';
    resetSoft();
    showPoster(video.thumb || ('https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'));
    if (lastRoute === 'file') return loadFile(video, autoplay, startAt);
    if (lastRoute === 'proxy') return loadProxy(video, autoplay, startAt);
    if (lastRoute === 'embed') return loadEmbed(video, autoplay, startAt);
    return loadGo(video, autoplay, startAt);
  }

  function state() {
    if (html5) {
      if (html5.ended) return 0;
      if (!html5.paused && html5.readyState >= 2) return 1;
      if (html5.paused && html5.currentTime > 0.2) return 2;
      if (html5.readyState === 2 || html5.seeking) return 3;
      return -1;
    }
    if (raw) return raw.st.s;
    if (bridge) return bridge.st.s;
    try { return yt && yt.getPlayerState ? yt.getPlayerState() : -1; }
    catch (e) { return -1; }
  }

  function buffered() {
    if (!html5) return 0;
    try {
      const b = html5.buffered;
      if (!b || !b.length) return 0;
      return b.end(b.length - 1) || 0;
    } catch (e) { return 0; }
  }

  function toggle() {
    const s = state();
    if (!yt && !bridge && !html5 && !raw) return;
    if (s === 1) {
      holdPause = true;
      if (html5) html5.pause();
      else if (raw) rawSend('pauseVideo');
      else if (bridge) bridgeSend({ cmd: 'pause' });
      else yt.pauseVideo();
      return;
    }
    holdPause = false;
    applyAll();
    if (html5 || raw) tryPlay(false);
    else if (bridge) bridgeSend({ cmd: 'play' });
    else yt.playVideo();
  }

  function pause() {
    if (html5) {
      try { html5.pause(); } catch (e) { /* ignored */ }
      return;
    }
    if (raw) {
      rawSend('pauseVideo');
      return;
    }
    if (bridge) {
      bridgeSend({ cmd: 'pause' });
      return;
    }
    if (yt) {
      try { yt.pauseVideo(); } catch (e) { /* ignored */ }
    }
  }

  function seek(delta) {
    if (html5) {
      try { html5.currentTime = Math.max(0, (html5.currentTime || 0) + delta); } catch (e) { /* ignored */ }
      return;
    }
    if (raw) {
      rawSend('seekTo', [Math.max(0, (raw.st.t || 0) + delta), true]);
      return;
    }
    if (bridge) {
      bridgeSend({ cmd: 'seekBy', t: delta });
      return;
    }
    if (!yt || !yt.getCurrentTime) return;
    try {
      const t = Math.max(0, yt.getCurrentTime() + delta);
      yt.seekTo(t, true);
    } catch (e) { /* player not ready */ }
  }

  function snapshot() {
    let t = 0;
    let d = 0;
    if (html5) {
      t = html5.currentTime || 0;
      d = html5.duration || 0;
    } else if (raw) {
      t = raw.st.t;
      d = raw.st.d;
    } else if (bridge) {
      t = bridge.st.t;
      d = bridge.st.d;
    } else {
      try {
        t = yt && yt.getCurrentTime ? yt.getCurrentTime() : 0;
        d = yt && yt.getDuration ? yt.getDuration() : 0;
      } catch (e) { /* not ready */ }
    }
    const s = state();
    return {
      time: t || 0,
      duration: Number.isFinite(d) ? (d || 0) : 0,
      buffered: buffered(),
      state: s,
      playing: s === 1,
      paused: s === 2,
      buffering: s === 3,
      ended: s === 0,
      error: lastError,
      route: lastRoute,
    };
  }

  function setHandlers(ended, change) {
    onEnded = ended;
    onChange = change;
  }

  function preload() {
    ensureApi();
  }

  return {
    load,
    destroy,
    toggle,
    seek,
    snapshot,
    setHandlers,
    applySound,
    applyAll,
    pause,
    preload,
    holdFocus,
    setSession,
    isMediaUrl,
    routesFor,
    routes: function () { return ROUTES.slice(); },
    lastError: function () { return lastError; },
    lastCode: function () { return lastErrorCode; },
    lastRoute: function () { return lastRoute; },
  };
})();
