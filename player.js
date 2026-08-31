/* YouTube playback. The iframe never takes focus so Neural Band keys
   keep belonging to the HUD.

   Ways, tried silently until one plays:
     0  HTML5 file (phone-resolved googlevideo URL, native hook, or glasses InnerTube)
     1  iframe that 302s to youtube.com/embed (YouTube is the frame document)
     2  /embed.html parse-time YouTube iframe
     3  JS-built iframe on www.youtube.com
     4  IFrame API-built iframe on www.youtube.com */
const Player = (() => {
  const WAYS = 5;
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
  let lastStrategy = 0;
  let holdPause = false;
  let hasPlayed = false;
  let onEnded = null;
  let onChange = null;
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

  function isMediaUrl(u) {
    u = String(u || '');
    return /^https:\/\/[a-z0-9.-]*googlevideo\.com\//i.test(u) &&
      /videoplayback/i.test(u) &&
      /[?&]itag=(18|22)(?:&|$)/.test(u) &&
      u.length >= 100;
  }

  function pickClientUrl(data) {
    const streaming = data && data.streamingData;
    const list = [].concat(
      (streaming && streaming.formats) || [],
      (streaming && streaming.adaptiveFormats) || []
    ).filter(function (f) { return f && f.url; });
    const progressive = list.filter(function (f) {
      const mime = String(f.mimeType || '');
      return /video\/mp4/i.test(mime) && /mp4a/i.test(mime) && Number(f.height || 0) <= 720;
    }).sort(function (a, b) { return Number(b.height || 0) - Number(a.height || 0); });
    const fmt = progressive[0] || list.find(function (f) { return Number(f.itag) === 18; }) || list[0];
    return fmt && isMediaUrl(fmt.url) ? fmt.url : null;
  }

  let clientStreamDead = false;

  function askClientStream(id) {
    if (clientStreamDead) return Promise.resolve(null);
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 2000);
    return fetch(
      'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w&prettyPrint=false',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-youtube-client-name': '3',
          'x-youtube-client-version': '20.10.38',
        },
        body: JSON.stringify({
          videoId: id,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
        }),
        signal: ctrl ? ctrl.signal : undefined,
      }
    ).then(function (r) { return r.json(); }).then(function (j) {
      const st = (j && j.playabilityStatus) || {};
      if (st.status && st.status !== 'OK') return null;
      return pickClientUrl(j);
    }).catch(function (e) {
      if (!e || e.name !== 'AbortError') clientStreamDead = true;
      return null;
    }).then(function (url) {
      clearTimeout(timer);
      return url || null;
    });
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

  function mountIframe(videoId, origin, referrer, autoplay, domain) {
    const slot = document.getElementById('yt-slot');
    if (!slot) return null;
    const params = new URLSearchParams({
      enablejsapi: '1',
      origin: origin,
      widget_referrer: referrer,
      autoplay: autoplay ? '1' : '0',
      mute: '1',
      controls: '0',
      disablekb: '1',
      fs: '0',
      rel: '0',
      playsinline: '1',
      iv_load_policy: '3',
    });
    const iframe = document.createElement('iframe');
    iframe.id = 'yt-host';
    iframe.width = '600';
    iframe.height = '338';
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.src = 'https://' + (domain || 'www.youtube.com') + '/embed/' +
      encodeURIComponent(videoId) + '?' + params.toString();
    slot.innerHTML = '';
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

  function embedOrigin() {
    return 'https://glasstube.vercel.app';
  }

  function embedReferrer() {
    return 'https://glasstube.vercel.app/';
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
          hasPlayed = true;
          holdPause = false;
          lastError = '';
          lastErrorCode = 0;
          if (!(prefs() && prefs().audioOnly())) hidePoster();
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

  function loadStatic(video, autoplay, startAt, path, extra) {
    const iframe = hostFrame();
    if (!iframe) return Promise.resolve(false);
    const params = new URLSearchParams({
      v: video.id,
      autoplay: autoplay ? '1' : '0',
      start: String(Math.floor(startAt || 0)),
    });
    if (extra && extra.host) params.set('host', extra.host);
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.referrerPolicy = 'origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    iframe.src = path + '?' + params.toString();
    listenBridge(iframe);
    ignoreEnded = false;
    lockIframe();
    applyPicture();
    startTick(autoplay);
    return Promise.resolve(true);
  }

  function bindYt(iframe, autoplay, startAt) {
    return ensureApi().then(function (ok) {
      if (!ok) {
        lastError = 'YouTube player script did not load.';
        lastErrorCode = -1;
        return false;
      }
      yt = new window.YT.Player(iframe, {
        events: {
          onReady: function (e) {
            ignoreEnded = false;
            lockIframe();
            holdFocus();
            applyAll();
            if (startAt && startAt > 3) {
              try { e.target.seekTo(startAt, true); } catch (err) { /* ignored */ }
            }
            if (autoplay) {
              tryPlay(true);
              playRetry = 0;
            }
          },
          onStateChange: function (e) {
            holdFocus();
            if (e.data === 1) {
              hasPlayed = true;
              holdPause = false;
              lastError = '';
              lastErrorCode = 0;
              if (!(prefs() && prefs().audioOnly())) hidePoster();
              applyRate();
              applyCaptions();
              if (soundOn()) {
                try { e.target.unMute(); } catch (err) { /* stays muted */ }
              } else {
                try { e.target.mute(); } catch (err) { /* ignored */ }
              }
            }
            if (e.data === 2) holdPause = true;
            if (e.data === 0 && !ignoreEnded && typeof onEnded === 'function') onEnded();
            if (typeof onChange === 'function') onChange(e.data);
          },
          onError: function (e) {
            lastErrorCode = Number(e.data) || 0;
            lastError = ytErrorText(e.data);
            if (typeof onChange === 'function') onChange('error');
          },
        },
      });
      lockIframe();
      startTick(autoplay);
      return true;
    });
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
          hasPlayed = true;
          holdPause = false;
          lastError = '';
          lastErrorCode = 0;
          if (!(prefs() && prefs().audioOnly())) hidePoster();
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
        if (raw.st.s === 1) {
          hasPlayed = true;
          lastError = '';
          lastErrorCode = 0;
          if (!(prefs() && prefs().audioOnly())) hidePoster();
        }
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

  function askNativeStream(id) {
    return new Promise(function (resolve) {
      const wk = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.glasstube;
      if (!wk) {
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
      try { wk.postMessage({ type: 'stream', id: id }); }
      catch (e) { finish(''); }
    }).then(function (url) {
      return url && url.indexOf('https://') === 0 ? url : null;
    });
  }

  function proxyUrl(id) {
    return '/api/watch?v=' + encodeURIComponent(id);
  }

  function resolveStream(video) {
    if (isMediaUrl(video && video.u)) return Promise.resolve(video.u);
    return askNativeStream(video.id).then(function (direct) {
      if (direct) return direct;
      return askClientStream(video.id);
    });
  }

  function loadHtml5(video, autoplay, startAt) {
    const slot = document.getElementById('yt-slot');
    if (!slot) return Promise.resolve(false);
    return resolveStream(video).then(function (direct) {
      const src = isMediaUrl(direct) ? direct : (video && video.id ? proxyUrl(video.id) : '');
      if (!src) {
        lastError = 'No playable file from the phone.';
        lastErrorCode = 0;
        return false;
      }
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
      hasPlayed = true;
      holdPause = false;
      lastError = '';
      lastErrorCode = 0;
      if (!(prefs() && prefs().audioOnly())) hidePoster();
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
      const mediaCode = media && media.code;
      lastErrorCode = 5;
      lastError = 'HTML5 media ' + (mediaCode || '?') + ' urlLen=' + String(src || '').length;
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
    });
  }

  function load(video, autoplay, startAt, strategy) {
    lastError = '';
    lastErrorCode = 0;
    holdPause = false;
    hasPlayed = false;
    const plan = Number(strategy) || 0;
    lastStrategy = plan;
    resetSoft();
    showPoster(video.thumb || ('https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'));
    if (plan === 0) return loadHtml5(video, autoplay, startAt);
    if (plan === 1) return loadGo(video, autoplay, startAt);
    if (plan === 2) return loadStatic(video, autoplay, startAt, '/embed.html');
    return ensureApi().then(function (ok) {
      if (!ok) {
        lastError = 'YouTube player script did not load.';
        lastErrorCode = -1;
        return false;
      }
      const origin = embedOrigin();
      const referrer = embedReferrer();
      const domain = 'www.youtube.com';
      const manual = plan !== 4;
      const host = manual
        ? mountIframe(video.id, origin, referrer, autoplay, domain)
        : mountHost();
      if (!host) return false;
      const vars = {
        autoplay: autoplay ? 1 : 0,
        mute: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        rel: 0,
        playsinline: 1,
        iv_load_policy: 3,
        enablejsapi: 1,
        origin: origin,
        widget_referrer: referrer,
      };
      const opts = {
        width: '600',
        height: '338',
        host: 'https://' + domain,
        playerVars: vars,
        events: {
          onReady: function (e) {
            ignoreEnded = false;
            lockIframe();
            holdFocus();
            applyAll();
            if (startAt && startAt > 3) {
              try { e.target.seekTo(startAt, true); } catch (err) { /* ignored */ }
            }
            if (autoplay) {
              tryPlay(true);
              playRetry = 0;
            }
          },
          onStateChange: function (e) {
            holdFocus();
            if (e.data === 1) {
              hasPlayed = true;
              holdPause = false;
              lastError = '';
              lastErrorCode = 0;
              if (!(prefs() && prefs().audioOnly())) hidePoster();
              applyRate();
              applyCaptions();
              if (soundOn()) {
                try { e.target.unMute(); } catch (err) { /* stays muted */ }
              } else {
                try { e.target.mute(); } catch (err) { /* ignored */ }
              }
            }
            if (e.data === 2) holdPause = true;
            if (e.data === 0 && !ignoreEnded && typeof onEnded === 'function') onEnded();
            if (typeof onChange === 'function') onChange(e.data);
          },
          onError: function (e) {
            lastErrorCode = Number(e.data) || 0;
            lastError = ytErrorText(e.data);
            if (typeof onChange === 'function') onChange('error');
          },
        },
      };
      if (!manual) opts.videoId = video.id;
      yt = new window.YT.Player(host, opts);
      lockIframe();
      startTick(autoplay);
      return true;
    });
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
    if (html5) tryPlay(false);
    else if (raw) tryPlay(false);
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
      duration: d || 0,
      state: s,
      playing: s === 1,
      paused: s === 2,
      buffering: s === 3,
      ended: s === 0,
      error: lastError,
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
    ways: function () { return WAYS; },
    lastError: function () { return lastError; },
    lastCode: function () { return lastErrorCode; },
    lastStrategy: function () { return lastStrategy; },
  };
})();
