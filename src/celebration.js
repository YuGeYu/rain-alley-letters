const COOLDOWN = 30 * 60 * 1000;
const milestones = new Set(['cs2-installed', 'account-created']);
const shown = new Set();
let active = null;
let reserved = false;

// Real milestones only; save cooldown before showing, including across restarts.
export async function celebrate(key, preferences, desktop) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!milestones.has(key) || reserved || active || shown.has(key) || shown.size >= 2 || document.hidden || preferences.lightweight || motion.matches) return false;
  const now = Date.now();
  if (now - (preferences.celebrationAt || 0) < COOLDOWN) return false;
  reserved = true;
  try {
    const current = await desktop.getState();
    if (now - (current.preferences.celebrationAt || 0) < COOLDOWN) return false;
    await desktop.saveState({ celebrationAt: now });
    preferences.celebrationAt = now;
    if (document.hidden || motion.matches || preferences.lightweight) return false;
    shown.add(key);
    const layer = document.createElement('div');
    layer.className = 'alley-celebration'; layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
    const colors = ['#80caff', '#b1a1ff', '#ff8edb', '#ffe5a1', '#fff5d9'];
    // Bounded CSS choreography, with no idle animation scheduler.
    for (let burst = 0; burst < 10; burst++) {
      const origin = document.createElement('div'); origin.className = 'celebration-burst';
      origin.style.cssText = `--x:${[12,88,48,25,76,50,8,92,33,66][burst]}%;--y:${[32,27,42,63,60,18,72,70,30,38][burst]}%;--delay:${burst * 340}ms;--spark:${colors[burst % colors.length]}`;
      const halo = document.createElement('span'); halo.className = 'celebration-halo'; origin.append(halo);
      const core = document.createElement('span'); core.className = 'celebration-core'; origin.append(core);
      for (let ray = 0; ray < 64; ray++) {
        const spark = document.createElement('i'); const angle = ray * Math.PI * 2 / 64; const radius = 100 + (ray % 4) * 50;
        spark.className = 'celebration-spark';
        spark.style.cssText = `--dx:${Math.cos(angle)*radius}px;--dy:${Math.sin(angle)*radius}px;--turn:${ray*9}deg`; origin.append(spark);
      }
      layer.append(origin);
    }
    for (let index = 0; index < 110; index++) {
      const ribbon = document.createElement('i'); ribbon.className = 'celebration-ribbon';
      ribbon.style.cssText = `--x:${(index*37)%100}%;--drift:${(index%2?1:-1)*(50+index%8*20)}px;--delay:${index%13*75}ms;--spark:${colors[index%colors.length]};--twist:${index%2?540:-540}deg`; layer.append(ribbon);
    }
    for (let index = 0; index < 34; index++) {
      const star = document.createElement('i'); star.className = 'celebration-stardust';
      star.style.cssText = `--x:${index * 31 % 100}%;--y:${index * 17 % 94}%;--delay:${index % 9 * 280}ms;--spark:${colors[index % colors.length]}`; layer.append(star);
    }
    const aurora = document.createElement('div'); aurora.className = 'celebration-aurora'; layer.prepend(aurora);
    document.querySelector('#sceneStage').append(layer); active = layer;
    const stop = () => { layer.remove(); if (active === layer) active = null; document.removeEventListener('visibilitychange', onVisibility); motion.removeEventListener('change', onMotion); document.removeEventListener('alley:suspend-effects', stop); clearTimeout(timer); };
    const onVisibility = () => { if (document.hidden) stop(); }; const onMotion = () => { if (motion.matches) stop(); }; const timer = setTimeout(stop, 7800);
    document.addEventListener('visibilitychange', onVisibility); motion.addEventListener('change', onMotion); document.addEventListener('alley:suspend-effects', stop);
    return true;
  } catch { return false; } finally { reserved = false; }
}
