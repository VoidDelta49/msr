export const BUILD = '11.32'; // shown in Options, so a cached old version is easy to spot
// Settings: global options + one settings block per bike, stored in localStorage 'cpmme'
export const GLOBAL_DEF = { bike: 'raider150', sound: true, amb: true, vol: .8, forceGL: false, showFps: true, showApi: true, sens: 10, fov: 72, ui: 10, lefty: false, analogBrk: true, tough: false, wc: true, gfx: 'med', autoRes: true, fxaa: true, grade: true, nightFx: true, ibl: true, n64: true, retro: 0, gpuCull: true, fpsCap: 60, tod: 'live', name: '', room: '', mpUrl: '', builds: [] };
// multiplayer relay (server/worker.js deployed to Cloudflare); Options > MULTIPLAYER can override it (cfg.mpUrl)
export const MP_URL = 'https://cpm-relay.msr49.workers.dev';
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
// so it doubles as the culling distance. dpr = pixel-ratio cap, (no MSAA: FXAA post pass instead, Options toggle), shadow = shadow map size (0 = off), lite = Lambert
// instead of PBR materials on the island (much cheaper per pixel on phones).
export const QUALITY = {
  low: { dpr: 1, shadow: 0, fog: 550, lite: true, aniso: 2 },
  med: { dpr: 1.5, shadow: 1024, fog: 1100, lite: false, aniso: 8 },
  high: { dpr: 2, shadow: 2048, fog: 1400, lite: false, aniso: 16 },
};
export const Q = QUALITY[cfg.gfx] || QUALITY.med;
export const save = () => { try { localStorage.setItem('cpmme', JSON.stringify(cfg)); } catch (e) { } };
// settings for one bike, filled with that bike's defaults
export function bikeCfg(bike) {
  const c = cfg.bikes[bike.id] || (cfg.bikes[bike.id] = {});
  for (const [k, v] of Object.entries(bike.defaults)) if (!(k in c)) c[k] = v;
  return c;
}
// game clock (day/night, HUD clocks): real time, or today's Philippine date at the fixed hour picked in Options (cfg.tod)
const PH = 8 * 36e5;
export function gameMs() {
  const n = Date.now(), h = cfg.tod; if (h == null || h === 'live') return n;
  const day = Math.floor((n + PH) / 864e5); return day * 864e5 - PH + h * 36e5 + n % 6e4; // seconds keep ticking (clock colon)
}
// Philippine wall clock {h, m, s} for the HUD clocks (matches the sky, including a fixed Options hour)
export function phClock() { const d = new Date(gameMs() + PH); return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() }; }

