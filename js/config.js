export const BUILD = '11.57'; // shown in Options, so a cached old version is easy to spot
// Settings: global options + one settings block per bike, stored in localStorage 'cpmme'
export const GLOBAL_DEF = { bike: 'raider150', sound: true, amb: true, vol: .8, forceGL: false, showFps: true, showApi: true, sens: 10, fov: 72, ui: 10, lefty: false, analogBrk: true, tough: false, wc: true, gfx: 'med', autoRes: true, aa: 'fxaa', grade: true, nightFx: true, ibl: true, n64: true, mblur: true, mbAmt: 5, retro: 0, gpuCull: true, fpsCap: 60, tod: 'live', name: '', room: '', mpUrl: '', builds: [] };
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
  // 11.46: the FXAA on/off toggle became one anti-aliasing mode (cfg.aa); keep what the player had picked
  if (old && !('aa' in old) && old.fxaa === false) cfg.aa = 'off';
} catch (e) { }
delete cfg.fxaa;
// Anti-aliasing modes (Options > GRAPHICS > Anti-aliasing, reloads). ms = MSAA samples, fx = FXAA post pass. MSAA is
// never the canvas's own `antialias` (WebGL gives the browser's fixed sample count, and it would not reach the post
// pass): it is the multisampled render target of the scene pass in renderer.js, so 2x/4x really are 2x/4x and combine
// with FXAA, the grade and the N64 filter. WebGPU only has 1 or 4 samples (2x becomes 4x); a GPU that cannot do the
// asked count gets the nearest it can, or FXAA if it cannot multisample at all (renderer.js AA tells which one is live).
export const AA_MODES = {
  off: { l: 'Off', ms: 0, fx: false },
  fxaa: { l: 'FXAA', ms: 0, fx: true },
  msaa2: { l: 'MSAA 2×', ms: 2, fx: false },
  msaa4: { l: 'MSAA 4×', ms: 4, fx: false },
  msaa4fx: { l: 'MSAA 4× + FXAA', ms: 4, fx: true },
};
if (!AA_MODES[cfg.aa]) cfg.aa = GLOBAL_DEF.aa;
// Graphics presets (Options > GRAPHICS, reloads). fog = draw distance in metres: past it everything is sky-coloured,
// so it doubles as the culling distance. dpr = pixel-ratio cap, shadow = shadow map size (0 = off), lite = Lambert
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

