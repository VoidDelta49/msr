// Live weather for the relay (11.99c): one snapshot for everybody, from Open-Meteo (no key), for ONE fixed point: the
// middle-of-the-Philippines point js/daynight.js uses for the sun. Never a player's location.
// Pure functions (tools/weather.mjs runs them in Node on a saved API answer); worker.js does the fetching.
//
// Snapshot = small integers, quantised so every client computes the same weather from it:
//   t  unix seconds of the 15-minute step the data is for
//   c  cloud cover %                     p  rain now, tenths of mm/h (0..255 = 25.5 mm/h and more)
//   r  rain over the last hour, tenths of mm (0..255): how wet the road already is when you arrive
//   th thunderstorm 0 / 1                w  wind km/h              d  wind direction it blows FROM, 2-degree steps (0..179)
//   v  visibility, 100 m steps (0..255)  k  temperature C          h  humidity %
export const WX_LAT = 12.88, WX_LON = 121.77, WX_STEP = 900;
export const WX_URL = 'https://api.open-meteo.com/v1/forecast?latitude=' + WX_LAT + '&longitude=' + WX_LON +
  '&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility' +
  '&minutely_15=precipitation&past_minutely_15=8&forecast_minutely_15=1&timezone=UTC';

const byte = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(+v) ? +v : 0)));
// Open-Meteo's JSON answer -> snapshot, or null when it is not usable
export function wxFromOpenMeteo(j) {
  const c = j && j.current; if (!c || typeof c.time !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(c.time)) return null;
  const ms = Date.parse(c.time + (c.time.length <= 16 ? ':00Z' : 'Z')); if (!Number.isFinite(ms)) return null;
  const t = Math.floor(ms / 1000 / WX_STEP) * WX_STEP, iv = c.interval > 0 ? c.interval : WX_STEP;
  // rain over the hour before this step: the 15-minute sums that end at or before it
  let r = 0; const m = j.minutely_15;
  if (m && Array.isArray(m.time) && Array.isArray(m.precipitation)) for (let i = 0; i < m.time.length; i++) {
    const s = Date.parse(m.time[i] + ':00Z') / 1000; if (s <= t && s > t - 3600 && Number.isFinite(+m.precipitation[i])) r += +m.precipitation[i];
  }
  const code = +c.weather_code;
  return {
    t, c: byte(c.cloud_cover, 0, 100), p: byte(c.precipitation * 3600 / iv * 10), r: byte(r * 10), th: code === 95 || code === 96 || code === 99 ? 1 : 0,
    w: byte(c.wind_speed_10m), d: byte((((+c.wind_direction_10m || 0) % 360) + 360) % 360 / 2, 0, 179), v: byte((c.visibility ?? 24000) / 100),
    k: byte(c.temperature_2m, -20, 60), h: byte(c.relative_humidity_2m, 0, 100),
  };
}
// a snapshot that came over the wire (relay -> client, or /wx): only these fields, integers in range, or null
const RANGE = { t: [0, 4e9], c: [0, 100], p: [0, 255], r: [0, 255], th: [0, 1], w: [0, 255], d: [0, 179], v: [0, 255], k: [-20, 60], h: [0, 100] };
export function cleanWx(m) {
  if (!m || typeof m !== 'object') return null; const o = {};
  for (const [k, [lo, hi]] of Object.entries(RANGE)) { const v = m[k]; if (!Number.isInteger(v) || v < lo || v > hi) return null; o[k] = v; }
  return o;
}
// when the room should look again: a minute into the next 15-minute step (the new data is out by then)
export const wxNext = nowMs => (Math.floor(nowMs / 1000 / WX_STEP) + 1) * WX_STEP * 1000 + 60000;
