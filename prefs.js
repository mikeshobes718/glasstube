const GlassPrefs = (() => {
  const KEY = 'glasstube.prefs';
  const SPEEDS = [1, 1.25, 1.5, 2];
  const REPEATS = ['off', 'one', 'all'];
  const SLEEPS = [0, 15, 30, 45, 60];
  const defaults = {
    captions: false,
    speed: 1,
    // Off by default: a list ends with 'Finished' instead of looping forever.
    repeat: 'off',
    shuffle: false,
    audioOnly: false,
    sleep: 0,
  };
  let data = Object.assign({}, defaults);

  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (raw && typeof raw === 'object') data = Object.assign({}, defaults, raw);
  } catch (e) { /* defaults */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { /* private mode */ }
  }

  function cycle(list, cur) {
    const i = list.indexOf(cur);
    return list[(i < 0 ? 0 : i + 1) % list.length];
  }

  return {
    captions() { return !!data.captions; },
    speed() { return Number(data.speed) || 1; },
    repeat() { return REPEATS.indexOf(data.repeat) >= 0 ? data.repeat : 'off'; },
    shuffle() { return !!data.shuffle; },
    audioOnly() { return !!data.audioOnly; },
    sleep() { return Number(data.sleep) || 0; },
    setCaptions(v) { data.captions = !!v; save(); },
    setSpeed(v) { data.speed = Number(v) || 1; save(); },
    setRepeat(v) { data.repeat = v; save(); },
    setShuffle(v) { data.shuffle = !!v; save(); },
    setAudioOnly(v) { data.audioOnly = !!v; save(); },
    setSleep(v) { data.sleep = Number(v) || 0; save(); },
    cycleSpeed() { data.speed = cycle(SPEEDS, this.speed()); save(); return data.speed; },
    cycleRepeat() { data.repeat = cycle(REPEATS, this.repeat()); save(); return data.repeat; },
    cycleSleep() { data.sleep = cycle(SLEEPS, this.sleep()); save(); return data.sleep; },
    speedLabel() {
      const n = this.speed();
      return n === 1 ? '1x' : (String(n) + 'x');
    },
    repeatLabel() {
      return { off: 'Off', one: 'One', all: 'All' }[this.repeat()] || 'Off';
    },
    sleepLabel() {
      const n = this.sleep();
      return n ? (n + ' min') : 'Off';
    },
  };
})();

/* interim: WP5 makes player.js read GlassPrefs directly. Until then player.js
   looks for window.GlassPrefs, which a top-level const never sets, so the
   player menu's Speed and Picture would do nothing. Harmless once WP5 lands. */
if (typeof window !== 'undefined') window.GlassPrefs = GlassPrefs;
