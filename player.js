/* Playback for the glasses HUD.

   Nothing here ever takes focus. The Neural Band sends arrow keys and Enter to
   whatever the document thinks is focused, so an iframe that grabs focus eats
   every gesture and the HUD goes dead. Every frame is tabindex="-1" and
   aria-hidden with pointer events off, and a window 'blur' listener pulls focus
   back out of any frame that takes it anyway.

   The file and proxy routes share ONE <video id="yt-video"> for the life of
   the page. Autoplay permission is per element on the glasses' WebView, so a
   new element per video meant a pinch per video. Player.unlock() plays it once
   inside the first gesture, and every later push or queued video can then
   start with sound and no pinch.

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
  /* 0.3s of silent Opus, played inside the first gesture to unlock the one
     <video>. */
  const SILENT_WEBM = 'data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAJvEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHGTbuMU6uEElTDZ1OsggEwTbuMU6uEHFO7a1OsggJZ7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBNgIRMYXZmV0GETGF2ZkSJiEBzQAAAAAAAFlSua+WuAQAAAAAAAFzXgQFzxYgAAAAAAAAAAZyBACK1nIN1bmSIgQCGhkFfT1BVU1aqg2MuoFa7hATEtACDgQLhkZ+BAbWIQOdwAAAAAABiZIEQY6KTT3B1c0hlYWQBATgBgLsAAAAAABJUw2fRc3POY8CLY8WIAAAAAAAAAAFnyJlFo4dFTkNPREVSRIeMTGF2YyBsaWJvcHVzZ8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4zMDgwMDAwMDAAH0O2dUDN54EAo4uBAACACAvmOyOrYKOKgQAVgAgIrLMOxqOKgQApgAgIrLMOxqOKgQA9gAgIrLMOxqOKgQBRgAgIrLMOxqOKgQBlgAgIrLMOxqOKgQB5gAgIrLMOxqOKgQCNgAgIrLMOxqOKgQChgAgIrLMOxqOKgQC1gAgIrLMOxqOKgQDJgAgIrLMOxqOKgQDdgAgIrLMOxqOKgQDxgAgIrLMOxqOKgQEFgAgIrLMOxqOKgQEZgAgIrLMOxqCToYqBAS0ACAissw7GdaKEAM3+YBxTu2uRu4+zgQC3iveBAfGCAYbwgQM=';
  const IFRAME_TICK_MS = 1000;
  const TIME_EVENT_MS = 900;

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
  let onEvent = null;
  let session = '';
  let videoNode = null;
  let unlocked = false;
  let mutedByPolicy = false;
  let autoplayBlocked = false;
  let playRejected = '';
  let loadSeq = 0;
  let loadAt = 0;
  let growthAt = 0;
  let lastBuffered = 0;
  let metaAt = 0;
  let pendingStart = 0;
  let lastTimeEvent = 0;
  let iframeReady = false;
  let stateSeen = false;
  let gestureAt = 0;
  let lastFocus = null;

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

  /* hqdefault (480x360) rather than the phone's mqdefault (320x180), which
     looked blurry stretched to 600 wide. object-fit: cover crops its bars. */
  function posterFor(video) {
    const id = String((video && video.id) || '');
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
    return (video && video.thumb) || '';
  }

  /* GlassSound and GlassPrefs are top-level consts, which never become
     window properties, so these must name them directly. */
  function soundOn() {
    return !(typeof GlassSound !== 'undefined' && !GlassSound.enabled());
  }

  function prefs() {
    return (typeof GlassPrefs !== 'undefined' ? GlassPrefs : null);
  }

  function userActive() {
    try { return !!(navigator.userActivation && navigator.userActivation.isActive); }
    catch (e) { return false; }
  }

  function emit(st) {
    if (typeof onChange === 'function') onChange(st);
  }

  function notify(kind) {
    if (typeof onEvent === 'function') onEvent(kind);
  }

  /* The one persistent <video>. Its listeners are attached once and act only
     while it is the current route (html5 === v), checking the element's live
     state rather than trusting an event queued for an older source. */
  function videoEl() {
    if (videoNode) return videoNode;
    videoNode = document.getElementById('yt-video');
    if (!videoNode) {
      const wrap = document.getElementById('yt-wrap');
      if (!wrap) return null;
      let slot = document.getElementById('yt-video-slot');
      if (!slot) {
        slot = document.createElement('div');
        slot.id = 'yt-video-slot';
        slot.className = 'hidden';
        const fs = document.getElementById('yt-slot');
        wrap.insertBefore(slot, fs ? fs.nextSibling : wrap.firstChild);
      }
      videoNode = document.createElement('video');
      videoNode.id = 'yt-video';
      videoNode.setAttribute('playsinline', '');
      videoNode.setAttribute('webkit-playsinline', '');
      videoNode.setAttribute('disablepictureinpicture', '');
      videoNode.preload = 'auto';
      videoNode.muted = true;
      slot.appendChild(videoNode);
    }
    videoNode.controls = false;
    wireVideo(videoNode);
    return videoNode;
  }

  function wireVideo(v) {
    const mine = () => html5 === v;
    v.addEventListener('playing', function () {
      if (!mine() || v.paused) return;
      markPlaying();
      applyRate();
      emit(1);
    });
    v.addEventListener('pause', function () {
      if (!mine() || !v.paused) return;
      if (!v.ended) {
        holdPause = true;
        notify('pause');
      }
      emit(2);
    });
    v.addEventListener('ended', function () {
      if (!mine() || !v.ended) return;
      notify('ended');
      if (!ignoreEnded && typeof onEnded === 'function') onEnded();
    });
    v.addEventListener('waiting', function () {
      if (mine()) emit(3);
    });
    v.addEventListener('timeupdate', function () {
      if (!mine()) return;
      const now = Date.now();
      if (now - lastTimeEvent < TIME_EVENT_MS) return;
      lastTimeEvent = now;
      emit('time');
    });
    v.addEventListener('progress', function () {
      if (!mine()) return;
      growthAt = Date.now();
      const now = growthAt;
      if (now - lastTimeEvent < TIME_EVENT_MS) return;
      lastTimeEvent = now;
      emit('progress');
    });
    v.addEventListener('loadedmetadata', function () {
      if (!mine()) return;
      metaAt = Date.now();
      if (pendingStart > 3) {
        try { v.currentTime = pendingStart; } catch (e) { /* ignored */ }
      }
      pendingStart = 0;
      // The readout can show the length even while the gate waits for a pinch.
      emit('meta');
    });
    v.addEventListener('durationchange', function () {
      if (mine()) emit('meta');
    });
    v.addEventListener('error', function () {
      if (!mine() || !v.error) return;
      const mediaCode = v.error.code || 0;
      lastErrorCode = 5;
      lastError = 'Media error ' + (mediaCode || '?') + ' on ' + lastRoute;
      emit('error');
    });
  }

  function showVideoSlot(on) {
    const vs = document.getElementById('yt-video-slot');
    const fs = document.getElementById('yt-slot');
    if (vs) vs.classList.toggle('hidden', !on);
    if (fs) fs.classList.toggle('hidden', !!on);
  }

  /* Called synchronously inside a real gesture (the first keydown, and again
     on any later key while still locked). A play() inside a gesture unlocks
     this element for the life of the page; unlocked turns true only once a
     play() has actually resolved. */
  function unlock() {
    const v = videoEl();
    if (!v || unlocked) return;
    try {
      if (html5 === v) {
        const wasPaused = v.paused;
        const p = v.play();
        if (wasPaused) {
          // Waiting at the gate: the play() call is what unlocks; do not start
          // playback from a swipe. The pinch handler plays it right after.
          v.pause();
          if (p && p.catch) p.catch(function () {});
        } else if (p && p.then) {
          p.then(function () { unlocked = true; }, function () {});
        }
        return;
      }
      if (!v.getAttribute('src')) v.src = SILENT_WEBM;
      v.muted = false;
      const p = v.play();
      if (p && p.then) {
        p.then(function () {
          unlocked = true;
          if (html5 !== v) {
            try { v.pause(); } catch (e) { /* ignored */ }
          }
        }, function () { /* still locked; the gate stays the floor */ });
      }
    } catch (e) { /* still locked; the gate stays the floor */ }
  }

  /* A pinch while playing muted by policy: sound on, keep playing. */
  function unmute() {
    mutedByPolicy = false;
    if (!html5) {
      applySound();
      return;
    }
    html5.muted = !soundOn();
    if (html5.paused) tryPlay(false);
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
      if (!want) {
        html5.muted = true;
        mutedByPolicy = false;
        return;
      }
      if (!html5.muted) return;
      // Unmuting a muted autoplay without a gesture makes Chrome pause it, so
      // only unmute once the element is unlocked or inside a gesture.
      if (unlocked || userActive()) {
        html5.muted = false;
        mutedByPolicy = false;
      } else if (!html5.paused) {
        mutedByPolicy = true;
      }
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
      // load() resets playbackRate to defaultPlaybackRate, so set both.
      try {
        html5.defaultPlaybackRate = n;
        html5.playbackRate = n;
      } catch (e) { /* ignored */ }
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
    const audio = !!(prefs() && prefs().audioOnly());
    wrap.classList.toggle('audio-only', audio);
    // Switching back to Video mid-play: the poster must not cover the picture.
    if (!audio && hasPlayed) hidePoster();
  }

  function applyAll() {
    applySound();
    applyCaptions();
    applyRate();
    applyPicture();
  }

  function tryPlay(forceMuteFirst) {
    if (html5) {
      playVideoEl(html5, loadSeq);
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

  /* Reads the play() promise instead of guessing from a timer. Sound first
     (when wanted); on NotAllowedError once more muted, and say so; if muted
     is refused too, autoplay is blocked and the gate is the only way on. */
  function playVideoEl(v, seq) {
    const wantSound = soundOn();
    v.muted = !wantSound;
    let p = null;
    try { p = v.play(); } catch (e) { p = null; }
    if (!p || typeof p.then !== 'function') return;
    p.then(function () {
      if (seq !== loadSeq) return;
      autoplayBlocked = false;
      playRejected = '';
      if (!v.muted) {
        unlocked = true;
        mutedByPolicy = false;
      }
    }, function (e) {
      if (seq !== loadSeq || html5 !== v) return;
      playRejected = String((e && e.name) || 'Error');
      // AbortError means a newer load or pause superseded it; a media failure
      // arrives as an 'error' event. Only a policy refusal is handled here.
      if (playRejected !== 'NotAllowedError') return;
      if (v.muted) {
        blockPlay();
        return;
      }
      v.muted = true;
      let p2 = null;
      try { p2 = v.play(); } catch (err) { p2 = null; }
      if (!p2 || typeof p2.then !== 'function') return;
      p2.then(function () {
        if (seq !== loadSeq) return;
        autoplayBlocked = false;
        mutedByPolicy = true;
        notify('muted');
      }, function (e2) {
        if (seq !== loadSeq || html5 !== v) return;
        playRejected = String((e2 && e2.name) || 'Error');
        if (playRejected === 'NotAllowedError') blockPlay();
      });
    });
  }

  function blockPlay() {
    if (autoplayBlocked) return;
    autoplayBlocked = true;
    notify('blocked');
    emit('blocked');
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
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.pointerEvents = 'none';
    slot.appendChild(iframe);
    return iframe;
  }

  function resetSoft() {
    ignoreEnded = true;
    stopTick();
    playRetry = 0;
    loadSeq += 1;
    autoplayBlocked = false;
    mutedByPolicy = false;
    playRejected = '';
    iframeReady = false;
    stateSeen = false;
    gestureAt = 0;
    pendingStart = 0;
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
      // Keep the element (it stays unlocked); just empty and hide it.
      try { html5.pause(); html5.removeAttribute('src'); html5.load(); } catch (e) { /* ignored */ }
    }
    html5 = null;
    showVideoSlot(false);
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
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  }

  /* Only ever blurs a frame. It never moves focus between HUD controls, so a
     menu that owns focus inside the player keeps it. */
  function holdFocus() {
    try {
      lockIframe();
      const active = document.activeElement;
      if (!active || active.tagName !== 'IFRAME') return;
      active.blur();
      if (window.focus) window.focus();
      if (lastFocus && lastFocus.isConnected && lastFocus.offsetParent !== null) {
        lastFocus.focus({ preventScroll: true });
      }
    } catch (e) { /* cross-origin iframe */ }
  }

  /* Iframe routes only: their time and state come by postMessage, so a 1s
     tick refreshes the chrome and nudges autoplay. It stops while paused.
     The <video> routes are driven by media events instead. */
  function startTick(autoplay) {
    stopTick();
    tick = setInterval(function () {
      const s = state();
      if (autoplay && !hasPlayed && !holdPause && !autoplayBlocked && s !== 1 && s !== 0 &&
          s !== 3 && !lastError) {
        if (playRetry < 8) {
          playRetry += 1;
          tryPlay(playRetry < 4);
          if (playRetry >= 4 && soundOn()) applySound(true);
        } else if (iframeReady) {
          // The player is up and has been asked to play eight times, yet it
          // sits unstarted or cued: that is the frame refusing autoplay.
          blockPlay();
        }
      }
      emit('tick');
    }, IFRAME_TICK_MS);
  }

  function stopTick() {
    if (tick) clearInterval(tick);
    tick = 0;
  }

  function markPlaying() {
    hasPlayed = true;
    holdPause = false;
    autoplayBlocked = false;
    lastError = '';
    lastErrorCode = 0;
    if (!(prefs() && prefs().audioOnly())) hidePoster();
  }

  /* A YouTube state change from either iframe route. */
  function iframeState(s) {
    if (s === 1) {
      markPlaying();
      applySound();
      if (!tick) startTick(false);
    }
    if (s === 2) {
      holdPause = true;
      stopTick();
      notify('pause');
    }
    if (s === 0 && !ignoreEnded) {
      notify('ended');
      if (typeof onEnded === 'function') onEnded();
    }
    emit(s);
  }

  function listenBridge(iframe) {
    bridge = { iframe: iframe, st: { s: -1, t: 0, d: 0 } };
    bridgeMsgHandler = function (ev) {
      if (ev.origin !== window.location.origin) return;
      const d = ev.data || {};
      if (!d.glasstubeEmbed || !bridge) return;
      if (d.type === 'ready') {
        iframeReady = true;
        stateSeen = true;
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
        stateSeen = true;
        bridge.st.s = d.state;
        iframeState(d.state);
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
    showVideoSlot(false);
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
        iframeReady = true;
        stateSeen = true;
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
        stateSeen = true;
        raw.st.s = s;
        iframeState(s);
        return;
      }
      if (evName === 'infoDelivery' && info && typeof info === 'object') {
        stateSeen = true;
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
    iframe.setAttribute('aria-hidden', 'true');
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
    showVideoSlot(false);
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

  /* Reuses the one <video>: new src, load(), and every per-video setting put
     back so nothing leaks from the last one. */
  function mountVideo(src, video, autoplay, startAt) {
    const v = videoEl();
    if (!v) return false;
    const slot = document.getElementById('yt-slot');
    if (slot) slot.innerHTML = '';
    try { v.pause(); } catch (e) { /* ignored */ }
    v.removeAttribute('poster');
    v.muted = true;
    pendingStart = startAt && startAt > 3 ? startAt : 0;
    loadAt = Date.now();
    growthAt = loadAt;
    metaAt = 0;
    lastBuffered = 0;
    lastTimeEvent = 0;
    html5 = v;
    v.src = src;
    v.load();
    applyRate();
    showVideoSlot(true);
    ignoreEnded = false;
    applyPicture();
    if (autoplay) tryPlay(false);
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
    loadAt = Date.now();
    growthAt = loadAt;
    showPoster(posterFor(video));
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
    // A pinch on the gate: the stall rules restart from now.
    autoplayBlocked = false;
    gestureAt = Date.now();
    growthAt = gestureAt;
    if ((raw || bridge) && !tick) startTick(false);
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
      // Stop a second short of the end, so a seek never ends the video by accident.
      const d = html5.duration;
      let t = Math.max(0, (html5.currentTime || 0) + delta);
      if (delta > 0 && Number.isFinite(d) && d > 0) t = Math.min(t, Math.max(html5.currentTime || 0, d - 1));
      try { html5.currentTime = t; } catch (e) { /* ignored */ }
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
      hasPlayed: hasPlayed,
      blocked: autoplayBlocked,
      mutedByPolicy: mutedByPolicy,
      playRejected: playRejected,
      readyState: html5 ? html5.readyState : -1,
      networkState: html5 ? html5.networkState : -1,
    };
  }

  /* Why the current route should be given up, from evidence, or ''. Never
     while it has played, or while the gate waits for a pinch. */
  function stallReason() {
    if (hasPlayed || autoplayBlocked) return '';
    if (lastError) return lastError;
    const now = Date.now();
    if (html5) {
      const v = html5;
      if (v.error) return 'Media error ' + (v.error.code || '?') + ' on ' + lastRoute;
      if (v.networkState === 3) return 'no source';
      if (lastRoute === 'proxy' && !metaAt && now - loadAt > 6000) return 'no metadata in 6s';
      const b = buffered();
      if (b > lastBuffered) {
        lastBuffered = b;
        growthAt = now;
      }
      // Still downloading is still alive. Only a starved element counts.
      if (v.readyState < 3 && now - growthAt > 10000) return 'no progress in 10s';
      return '';
    }
    if (raw || bridge) {
      if (!stateSeen && now - loadAt > 20000) return 'no player state in 20s';
      if (gestureAt && now - gestureAt > 20000) return 'did not start 20s after a pinch';
    }
    return '';
  }

  function setHandlers(ended, change, event) {
    onEnded = ended;
    onChange = change;
    onEvent = event || null;
  }

  /* Keep focus out of the frames: remember the HUD's own control, and if a
     frame takes focus (the window blurs), put it back after 60ms. */
  document.addEventListener('focusin', function (e) {
    const t = e.target;
    if (t && t.tagName && t.tagName !== 'IFRAME') lastFocus = t;
  }, true);
  window.addEventListener('blur', function () {
    setTimeout(holdFocus, 60);
  });
  videoEl();

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
    holdFocus,
    setSession,
    isMediaUrl,
    routesFor,
    unlock,
    unmute,
    stallReason,
    unlocked: function () { return unlocked; },
    mutedByPolicy: function () { return mutedByPolicy; },
    autoplayBlocked: function () { return autoplayBlocked; },
    routes: function () { return ROUTES.slice(); },
    lastError: function () { return lastError; },
    lastCode: function () { return lastErrorCode; },
    lastRoute: function () { return lastRoute; },
  };
})();
