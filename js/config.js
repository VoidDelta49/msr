export const BUILD = '5.7'; // shown in Options, so a cached old version is easy to spot
// Settings: global options + one settings block per bike, stored in localStorage 'cpmme'
export const GLOBAL_DEF = { bike: 'raider150', sound: true, forceGL: false, showFps: true, showApi: true, sens: 10, tough: false, gfx: 'med', autoRes: true };
export const cfg = { ...GLOBAL_DEF, bikes: {} };
try {
  const old = JSON.parse(localStorage.getItem('cpmme') || '{}');
  // pre-1.0 saves were flat (Raider-only): move bike keys into bikes.raider150
  if (old && !old.bikes) {
    const b = {};
    for (const k of ['exhaust', 'ecu', 'tires', 'paint', 'fs', 'rs', 'kf', 'kr', 'damp', 'autoClutch']) if (k in old) { b[k] = old[k]; delete old[k]; }
    old.bikes = { raider150: b };
  }
  Object.assign(cfg, old);
} catch (e) { }
// Graphics presets (Options > GRAPHICS, reloads). fog = draw distance in metres: past it everything is sky-coloured,
// so it doubles as the culling distance. dpr = pixel-ratio cap, shadow = shadow map size (0 = off), lite = Lambert
// instead of PBR materials on the island (much cheaper per pixel on phones).
export const QUALITY = {
  low: { aa: false, dpr: 1, shadow: 0, fog: 550, lite: true, aniso: 2 },
  med: { aa: true, dpr: 1.5, shadow: 1024, fog: 1100, lite: false, aniso: 8 },
  high: { aa: true, dpr: 2, shadow: 2048, fog: 1400, lite: false, aniso: 16 },
};
export const Q = QUALITY[cfg.gfx] || QUALITY.med;
export const save = () => { try { localStorage.setItem('cpmme', JSON.stringify(cfg)); } catch (e) { } };
// settings for one bike, filled with that bike's defaults
export function bikeCfg(bike) {
  const c = cfg.bikes[bike.id] || (cfg.bikes[bike.id] = {});
  for (const [k, v] of Object.entries(bike.defaults)) if (!(k in c)) c[k] = v;
  return c;
}
