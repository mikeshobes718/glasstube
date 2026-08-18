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
