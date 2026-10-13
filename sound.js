const GlassSound = (() => {
  const KEY = 'glasstube.sound';
  let on = true;
  try {
    if (localStorage.getItem(KEY) === '0') on = false;
  } catch (e) { /* default on */ }

  return {
    enabled() { return on; },
    setEnabled(v) {
      on = !!v;
      try { localStorage.setItem(KEY, on ? '1' : '0'); }
      catch (e) { /* preference just will not persist */ }
      if (typeof Player !== 'undefined' && Player.applySound) Player.applySound(on);
    },
  };
})();

/* interim: WP5 makes player.js read GlassSound directly; until then this alias
   lets the player menu's Sound row reach the playing video. */
if (typeof window !== 'undefined') window.GlassSound = GlassSound;
