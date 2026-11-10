// Weather (12.00): the headless half. A snapshot in (from the relay: a room's `wx` message or GET /wx, see server/wx.js), sky,
// rain, wind, lightning and road-wetness values out. No three.js, no DOM: `node tools/weather.mjs` runs it. Drawing and the
// fetching are js/wxfig.js; daynight.js reads WX for the light, physics.js reads ctx.wet for the grip (tyre.js wetGrip).
// Everything is blended on the client: a new snapshot only moves the targets, the sky then eases to it over a few seconds.
import { clamp, sstep } from './util.js';

// Options > Game > Weather (cfg.wx). Live = the real weather over the Philippines right now.
export const WX_MODES = [['live', 'Live PH'], ['clear', 'Clear'], ['rain', 'Light rain'], ['storm', 'Storm']];
// fixed weathers, in the relay's snapshot units (server/wx.js)
const PRESET = {
  clear: { t: 0, c: 12, p: 0, r: 0, th: 0, w: 8, d: 20, v: 240, k: 30, h: 65 },
  rain: { t: 0, c: 90, p: 22, r: 14, th: 0, w: 16, d: 20, v: 90, k: 26, h: 90 },
  storm: { t: 0, c: 100, p: 170, r: 150, th: 1, w: 48, d: 20, v: 30, k: 24, h: 96 },
};
const RANGE = { t: [0, 4e9], c: [0, 100], p: [0, 255], r: [0, 255], th: [0, 1], w: [0, 255], d: [0, 179], v: [0, 255], k: [-20, 60], h: [0, 100] };
// a snapshot off the wire: only the known fields, integers in range (same rule as server/wx.js cleanWx), or null
export function cleanWx(m) {
  if (!m || typeof m !== 'object') return null; const o = {};
  for (const [k, [lo, hi]] of Object.entries(RANGE)) { const v = m[k]; if (!Number.isInteger(v) || v < lo || v > hi) return null; o[k] = v; }
  return o;
}
const STALE = 2.5 * 3600; // a live snapshot older than this (no relay, offline) is given up: back to clear

/* WX = the weather right now, eased. cover 0..1 cloud, rain 0..1 (0.2 drizzle .. 1 downpour), mmh, thunder 0..1, wind m/s and
   (wx, wz) the unit direction it blows TOWARD in map axes (north = -z, east = +x), vis metres, temp C, hum 0..1,
   wet 0..1 = water on the road (rises in rain, dries afterwards), flash 0..1 = lightning lighting the sky this instant. */
export const WX = {
  live: null, mode: '', src: 'clear', init: false, cover: .12, rain: 0, mmh: 0, thunder: 0, wind: 2, wx: 0, wz: 1, vis: 24000, temp: 30, hum: .65,
  wet: 0, flash: 0, strike: null, sec: 0,
};
// a live snapshot arrived (already cleaned)
export function wxLive(snap) { WX.live = snap; }
// which snapshot rules now, and where it came from
export function wxPick(mode, nowMs) {
  if (mode && mode !== 'live' && PRESET[mode]) { WX.src = mode; return PRESET[mode]; }
  if (WX.live && nowMs / 1000 - WX.live.t < STALE) { WX.src = 'live'; return WX.live; }
  WX.src = 'clear'; return PRESET.clear;
}
// snapshot units -> the values above (targets)
const TG = {};
export function wxDerive(s, o = TG) {
  o.cover = s.c / 100; o.mmh = s.p / 10; o.rain = Math.min(1, Math.sqrt(o.mmh / 16)); o.thunder = s.th; o.wind = s.w / 3.6;
  const a = s.d * 2 * Math.PI / 180; o.wx = -Math.sin(a); o.wz = Math.cos(a); // blows FROM bearing a (north = -z), so toward the opposite
  o.vis = Math.max(150, s.v * 100); o.temp = s.k; o.hum = s.h / 100;
  // the road as you find it: wet while it rains, and still wet after a rainy hour
  o.wet0 = Math.max(o.rain > .02 ? Math.min(1, .45 + o.rain) : 0, Math.min(.9, s.r / 10 / 1.5));
  return o;
}
// integer hash -> 0..1 (the same on every client, so a room sees the same lightning)
function h01(n) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }
// lightning in a thunderstorm: one in ~9 seconds strikes, somewhere 0.8-10 km away. Keyed on the wall-clock second.
export function strikeAt(sec) {
  if (h01(sec) > .11) return null;
  return { at: sec * 1000 + Math.floor(h01(sec + 7919) * 1000), dist: 800 + h01(sec + 104729) * 9200, brg: h01(sec + 1299709) * 2 * Math.PI, heard: false };
}
// brightness of a strike `age` ms after it: a hard flash, a dimmer second stroke, gone in under a second; nearer = brighter
export function flashOf(st, nowMs) {
  const age = nowMs - st.at; if (age < 0 || age > 900) return 0;
  return (Math.exp(-age / 70) + (age > 160 ? .65 * Math.exp(-(age - 160) / 110) : 0)) * (1 - .55 * st.dist / 10000);
}

/* one frame: dt seconds, nowMs = the real clock, mode = cfg.wx, sun 0..1 = how much sun reaches the road (drying). */
export function wxStep(dt, nowMs, mode = 'live', sun = .5) {
  const src0 = WX.src, s = wxPick(mode, nowMs), t = wxDerive(s), first = !WX.init, sw = WX.mode !== (mode || 'live') || first || WX.src !== src0; // (src changes when the first live snapshot arrives, or it goes stale)
  WX.mode = mode || 'live'; WX.init = true;
  const k = first ? 1 : 1 - Math.exp(-dt / 5);
  for (const f of ['cover', 'rain', 'mmh', 'thunder', 'wind', 'vis', 'temp', 'hum']) WX[f] += (t[f] - WX[f]) * k;
  // wind direction: ease the vector, keep it a unit
  { const x = WX.wx + (t.wx - WX.wx) * k, z = WX.wz + (t.wz - WX.wz) * k, l = Math.hypot(x, z); if (l > 1e-3) { WX.wx = x / l; WX.wz = z / l; } else { WX.wx = t.wx; WX.wz = t.wz; } }
  // road water. Picking a weather in Options (or the first live snapshot arriving) puts the road where that weather would have it;
  // after that it fills in the rain (a downpour soaks it in half a minute, drizzle in a few) and dries in 10-40 minutes:
  // faster in sun, wind and heat, slower in humid air.
  if (sw) WX.wet = t.wet0;
  else if (WX.rain > .02) WX.wet = Math.min(1, WX.wet + dt * (.004 + .03 * WX.rain));
  else WX.wet = Math.max(0, WX.wet - dt / 1500 * (.6 + 1.6 * sun * (1 - WX.cover) + WX.wind / 12 + sstep(22, 34, WX.temp) * .5) * (1.35 - WX.hum));
  // lightning
  WX.flash = 0;
  if (WX.thunder > .5) {
    const sec = Math.floor(nowMs / 1000);
    if (sec !== WX.sec) { for (let q = Math.max(sec - 2, WX.sec + 1); q <= sec; q++) { const st = strikeAt(q); if (st) WX.strike = st; } WX.sec = sec; }
  }
  if (WX.strike) { WX.flash = clamp(flashOf(WX.strike, nowMs), 0, 1) * WX.thunder; if (nowMs - WX.strike.at > 40000) WX.strike = null; }
  return WX;
}
// one line for Options: what the sky is doing now
export function wxText(W = WX) {
  const sky = W.cover < .2 ? 'clear' : W.cover < .55 ? 'partly cloudy' : W.cover < .85 ? 'cloudy' : 'overcast';
  const rn = W.thunder > .5 ? 'thunderstorm' : W.mmh < .1 ? '' : W.mmh < 2.5 ? 'light rain' : W.mmh < 8 ? 'rain' : 'heavy rain';
  return `${Math.round(W.temp)} °C · ${sky}${rn ? ' · ' + rn : ''} · wind ${Math.round(W.wind * 3.6)} km/h${W.wet > .15 && !rn ? ' · wet roads' : ''}`;
}
// the thunder of the last strike has reached us (sound takes dist / 343 s): true once per strike
export function thunderDue(nowMs) {
  const st = WX.strike; if (!st || st.heard || nowMs < st.at + st.dist / .343) return null;
  st.heard = true; return st;
}

// sun elevation in degrees over the middle of the Philippines at `ms` (the same low-precision formula as daynight.js astro():
// here without three.js, for the main menu's sky before the game is loaded)
export function sunElev(ms) {
  const R = Math.PI / 180, d = ms / 864e5 - 10957.5, e = (23.439 - 3.6e-7 * d) * R, g = (357.529 + .98560028 * d) * R, L = (280.459 + .98564736 * d) * R + (1.915 * Math.sin(g) + .02 * Math.sin(2 * g)) * R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L)), ha = (280.46061837 + 360.98564736629 * d + 121.77) * R - ra, la = 12.88 * R;
  return Math.asin(clamp(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha), -1, 1)) / R;
}

/* what the sky and the light do with it (daynight.js / wxfig.js): all 0..1 unless said.
   ovc = how much of the dome the cloud mask covers, grey = sky colours pulled to overcast grey, sunK / hemiK = light left,
   far / near = fog range in metres given the clear-day range (farMax, nearMax). */
const SK = {};
export function wxSky(farMax = 1100, nearMax = 121, W = WX, o = SK) {
  const thick = clamp(W.cover * .55 + W.rain * .5 + W.thunder * .2, 0, 1), ov = sstep(.3, 1, W.cover);
  o.ovc = W.cover; o.thick = thick; o.grey = ov * (.55 + .45 * thick);
  o.sunK = 1 - .88 * ov * (.5 + .5 * thick); o.hemiK = 1 - .55 * thick * ov; o.dark = .7 * thick * ov; // dark: cloud undersides
  const far = Math.min(farMax, W.vis, 4000 - 3300 * W.rain), haze = sstep(20000, 1500, W.vis) * .7 + W.rain * .25;
  o.far = Math.max(150, far); o.near = Math.max(8, nearMax * (o.far / farMax) * (1 - Math.min(.85, haze)));
  return o;
}
