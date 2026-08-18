/* YouTube IFrame API wrapper. The iframe never takes focus so Neural Band
   keys keep belonging to the HUD. */
const Player = (() => {
  let yt = null;
  let tick = 0;
  let playRetry = 0;
  let ignoreEnded = false;
  let lastError = '';
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

  function applySound(on) {
    if (!yt) return;
    const want = on !== undefined ? !!on : soundOn();
    try {
      if (want) yt.unMute();
      else yt.mute();
    } catch (e) { /* player not ready */ }
  }

  function prefs() {
    return window.GlassPrefs || null;
  }

  function applyCaptions() {
    if (!yt) return;
    const on = prefs() && prefs().captions();
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
    if (!yt) return;
    const n = prefs() ? prefs().speed() : 1;
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

  function destroy() {
    ignoreEnded = true;
    if (tick) {
      clearInterval(tick);
      tick = 0;
    }
    playRetry = 0;
    if (yt) {
      try { yt.destroy(); } catch (e) { /* already gone */ }
      yt = null;
    }
    mountHost();
  }

  function lockIframe() {
    const iframe = (yt && yt.getIframe && yt.getIframe()) ||
      document.querySelector('#yt-slot iframe');
    if (!iframe) return;
    iframe.setAttribute('tabindex', '-1');
    iframe.style.pointerEvents = 'none';
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

  function load(video, autoplay, startAt) {
    lastError = '';
    destroy();
    showPoster(video.thumb || ('https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg'));
    return ensureApi().then(function (ok) {
      if (!ok) {
        lastError = 'YouTube player script did not load.';
        return false;
      }
      const host = mountHost();
      if (!host) return false;
      yt = new window.YT.Player(host, {
        width: '600',
        height: '338',
        videoId: video.id,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          mute: autoplay ? 1 : (soundOn() ? 0 : 1),
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: function (e) {
            ignoreEnded = false;
            try { e.target.setPlaybackQuality('medium'); } catch (err) { /* ignored */ }
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
              if (!(prefs() && prefs().audioOnly())) hidePoster();
              applyRate();
              applyCaptions();
              if (soundOn()) {
                try { e.target.unMute(); } catch (err) { /* stays muted */ }
              } else {
                try { e.target.mute(); } catch (err) { /* ignored */ }
              }
            }
            if (e.data === 0 && !ignoreEnded && typeof onEnded === 'function') onEnded();
            if (typeof onChange === 'function') onChange(e.data);
          },
          onError: function (e) {
            const map = {
              2: 'Bad video id.',
              5: 'HTML5 player error.',
              100: 'Video not found.',
              101: 'This video cannot play in the glasses.',
              150: 'This video cannot play in the glasses.',
            };
            lastError = map[e.data] || ('YouTube error ' + e.data);
            if (typeof onChange === 'function') onChange('error');
          },
        },
      });
      lockIframe();
      tick = setInterval(function () {
        holdFocus();
        if (autoplay && yt && state() !== 1 && state() !== 0 && !lastError && playRetry < 8) {
          playRetry += 1;
          tryPlay(playRetry < 4);
          if (playRetry >= 4 && soundOn()) {
            try { yt.unMute(); } catch (err) { /* ignored */ }
          }
        }
        if (typeof onChange === 'function') onChange('tick');
      }, 400);
      return true;
    });
  }

  function state() {
    try { return yt && yt.getPlayerState ? yt.getPlayerState() : -1; }
    catch (e) { return -1; }
  }

  function toggle() {
    const s = state();
    if (!yt) return;
    if (s === 1) yt.pauseVideo();
    else {
      applyAll();
      yt.playVideo();
    }
  }

  function pause() {
    if (yt) {
      try { yt.pauseVideo(); } catch (e) { /* ignored */ }
    }
  }

  function seek(delta) {
    if (!yt || !yt.getCurrentTime) return;
    try {
      const t = Math.max(0, yt.getCurrentTime() + delta);
      yt.seekTo(t, true);
    } catch (e) { /* player not ready */ }
  }

  function snapshot() {
    let t = 0;
    let d = 0;
    try {
      t = yt && yt.getCurrentTime ? yt.getCurrentTime() : 0;
      d = yt && yt.getDuration ? yt.getDuration() : 0;
    } catch (e) { /* not ready */ }
    return {
      time: t || 0,
      duration: d || 0,
      playing: state() === 1,
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
    lastError: function () { return lastError; },
  };
})();
