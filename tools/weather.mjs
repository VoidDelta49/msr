#!/usr/bin/env node
// Headless checks of the weather (js/weather.js + server/wx.js + tyre.js wetGrip). No browser, no three.js, no network.
//   node tools/weather.mjs [-v]     (also part of tools/test.mjs)
//   node tools/weather.mjs --live   also asks Open-Meteo right now and prints the snapshot the relay would send (needs the network)
// Fails on: the relay turning a saved Open-Meteo answer (tools/fixtures/open-meteo.json) into anything but the expected snapshot,
// or not rejecting broken answers; a snapshot the relay makes that the client refuses (the two cleaners must agree); the wire
// size; the Options modes; stale live data not falling back to clear; the road not wetting in rain / drying after; lightning that
// differs between two clients or comes too often / never; fog and light values out of range; wet grip that is not 1 on a dry road,
// not monotonic in wetness and speed, or a tyre table whose wet numbers are missing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, bikeIds, loadBike } from './lib/headless.mjs';
const J = rel => pathToFileURL(path.join(ROOT, rel)).href, verbose = process.argv.includes('-v');
const SV = await import(J('server/wx.js')), W = await import(J('js/weather.js')), { wetGrip } = await import(J('js/tyre.js'));

export function weatherTests() {
  const P = [], bad = m => P.push('WEATHER ' + m), info = [];
  const { WX, cleanWx, wxLive, wxStep, wxPick, wxDerive, wxSky, strikeAt, flashOf, thunderDue, WX_MODES } = W;
  const reset = () => Object.assign(WX, { live: null, mode: '', init: false, wet: 0, strike: null, sec: 0, flash: 0 });

  // ---- relay: Open-Meteo answer -> snapshot ----
  const fx = JSON.parse(readFileSync(path.join(ROOT, 'tools/fixtures/open-meteo.json'), 'utf8')), s = SV.wxFromOpenMeteo(fx);
  const want = { t: 1794306600, c: 84, p: 20, r: 24, th: 0, w: 22, d: 13, v: 35, k: 26, h: 86 };
  if (JSON.stringify(s) !== JSON.stringify(want)) bad(`fixture became ${JSON.stringify(s)}, expected ${JSON.stringify(want)}`);
  if (s && s.t % SV.WX_STEP) bad('snapshot time is not on a 15-minute step');
  if (s && JSON.stringify({ t: 'wx', wx: s }).length > 110) bad(`wx message is ${JSON.stringify({ t: 'wx', wx: s }).length} bytes (plan: about 100)`);
  for (const [n, j] of [['null', null], ['no current', {}], ['bad time', { current: { time: 'soon' } }]]) if (SV.wxFromOpenMeteo(j) !== null) bad(`relay accepted a broken answer (${n})`);
  { const j = JSON.parse(JSON.stringify(fx)); j.current.weather_code = 95; j.current.cloud_cover = 250; j.current.visibility = null; delete j.minutely_15; const q = SV.wxFromOpenMeteo(j);
    if (!q || q.th !== 1 || q.c !== 100 || q.r !== 0 || !SV.cleanWx(q)) bad(`odd values not clamped: ${JSON.stringify(q)}`); }
  if (JSON.stringify(SV.cleanWx(s)) !== JSON.stringify(cleanWx(s))) bad('server and client cleanWx disagree on a good snapshot');
  for (const b of [{ ...want, c: 101 }, { ...want, p: 1.5 }, { ...want, th: 2 }, { ...want, d: 180 }, { c: 1 }, null, 'x', { ...want, t: -1 }]) if (cleanWx(b) || SV.cleanWx(b)) bad(`a bad snapshot was accepted: ${JSON.stringify(b)}`);
  if (Object.keys(cleanWx({ ...want, evil: 1 })).includes('evil')) bad('unknown fields pass through cleanWx');
  { const n = SV.wxNext(1794306600000 + 5000); if (n !== (1794306600 + 900) * 1000 + 60000) bad(`wxNext = ${n}`); }
  if (!/latitude=12\.88&longitude=121\.77/.test(SV.WX_URL)) bad('the relay does not ask for the fixed Philippine point');

  // ---- modes, live data, falling back ----
  const now = want.t * 1000 + 6e5;
  reset(); wxStep(.016, now, 'live'); if (WX.src !== 'clear' || WX.rain !== 0 || WX.wet !== 0) bad(`no snapshot yet should be clear and dry (src ${WX.src}, rain ${WX.rain}, wet ${WX.wet})`);
  reset(); wxLive(cleanWx(want)); wxStep(.016, now, 'live');
  if (WX.src !== 'live' || Math.abs(WX.cover - .84) > 1e-9 || !(WX.rain > .3 && WX.rain < .4) || !(WX.wet > .7)) bad(`live snapshot not applied at once (src ${WX.src}, cover ${WX.cover}, rain ${WX.rain}, wet ${WX.wet})`);
  if (Math.abs(Math.hypot(WX.wx, WX.wz) - 1) > 1e-6 || !(WX.wz > .8 && WX.wx < 0)) bad(`wind from 26 deg (NNE) should blow toward the south-south-west: (${WX.wx}, ${WX.wz})`);
  wxStep(.016, now + 3 * 3600e3, 'live'); if (WX.src !== 'clear') bad('a 3-hour-old snapshot is still used (should fall back to clear)');
  for (const [m] of WX_MODES) { reset(); wxLive(cleanWx(want)); wxStep(.016, now, m); if (m !== 'live' && WX.src !== m) bad(`mode ${m} gives ${WX.src}`); }
  reset(); wxStep(.016, now, 'storm'); if (!(WX.rain > .95 && WX.thunder === 1 && WX.wet > .95 && WX.cover === 1)) bad('storm preset is not a storm');
  reset(); wxStep(.016, now, 'clear'); if (WX.rain || WX.wet || WX.thunder) bad('clear preset is not clear');
  // switching eases the sky (no snap) but puts the road where that weather has it
  reset(); wxStep(.016, now, 'clear'); wxStep(.016, now + 16, 'storm');
  if (!(WX.rain < .05 && WX.wet > .9)) bad(`switching to storm: rain ${WX.rain} (should ease in), wet ${WX.wet} (should be soaked)`);
  for (let i = 0; i < 60 * 30; i++) wxStep(1 / 60, now + i * 16, 'storm'); if (!(WX.rain > .95)) bad(`30 s after switching, the rain is only ${WX.rain}`);

  // ---- the road: wets in rain, dries afterwards ----
  { reset(); wxLive({ ...want, p: 0, r: 0, c: 30 }); wxStep(.016, now, 'live'); if (WX.wet !== 0) bad('dry snapshot starts wet');
    wxLive({ ...want, p: 160, r: 0 }); let t = 0; while (WX.wet < .95 && t < 600) { wxStep(.1, now + t * 1000, 'live'); t += .1; }
    if (!(t > 10 && t < 120)) bad(`a downpour soaks a dry road in ${t.toFixed(0)} s (want 10-120)`); info.push(`soak ${t.toFixed(0)} s`);
    wxLive({ ...want, p: 0, r: 0, c: 20, h: 60, w: 10 }); let d = 0; while (WX.wet > .02 && d < 3 * 3600) { wxStep(1, now + (t + d) * 1000, 'live', 1); d++; }
    if (!(d > 300 && d < 2400)) bad(`a soaked road dries in the sun in ${(d / 60).toFixed(0)} min (want 5-40)`); info.push(`dry (sun) ${(d / 60).toFixed(0)} min`);
    reset(); wxLive({ ...want, p: 160 }); wxStep(.016, now, 'live'); wxLive({ ...want, p: 0, r: 0, c: 100, h: 95, w: 0 }); let n = 0; while (WX.wet > .02 && n < 5 * 3600) { wxStep(1, now + n * 1000, 'live', 0); n++; }
    if (!(n > d * 1.5 && n < 3 * 3600)) bad(`drying at night in still humid air takes ${(n / 60).toFixed(0)} min (sun: ${(d / 60).toFixed(0)})`); info.push(`dry (humid night) ${(n / 60).toFixed(0)} min`);
    if (!(WX.wet >= 0 && WX.wet <= 1)) bad('wet left 0..1'); }

  // ---- lightning: the same for everyone, a few per minute in a storm, none otherwise ----
  { let n = 0; for (let q = 1e6; q < 1e6 + 3600; q++) { const a = strikeAt(q), b = strikeAt(q); if (JSON.stringify(a) !== JSON.stringify(b)) bad('strikeAt is not deterministic'); if (a) { n++; if (!(a.dist >= 800 && a.dist <= 10000 && a.at >= q * 1000 && a.at < q * 1000 + 1000)) bad(`strike out of range ${JSON.stringify(a)}`); } }
    if (!(n > 250 && n < 550)) bad(`${n} strikes an hour (want 250-550)`); info.push(`${n} strikes/h`);
    const st = { at: 1000, dist: 1000 }; if (!(flashOf(st, 1000) > .9 && flashOf(st, 999) === 0 && flashOf(st, 2000) === 0 && flashOf({ at: 1000, dist: 9000 }, 1000) < flashOf(st, 1000))) bad('flash shape');
    reset(); let fl = 0, th = 0, mx = 0; for (let i = 0; i < 60 * 180; i++) { const t = now + i * 1000 / 60; wxStep(1 / 60, t, 'storm'); if (WX.flash > .3) fl++; mx = Math.max(mx, WX.flash); if (thunderDue(t)) th++; }
    if (!(fl > 0 && mx <= 1 && th > 3)) bad(`3 minutes of storm: ${fl} bright frames, peak ${mx}, ${th} thunders`);
    reset(); let f2 = 0; for (let i = 0; i < 60 * 120; i++) { wxStep(1 / 60, now + i * 1000 / 60, 'rain'); if (WX.flash > 0 || thunderDue(now + i * 16)) f2++; } if (f2) bad('lightning without a thunderstorm'); }

  // ---- sky / fog / light numbers ----
  for (const [m] of WX_MODES) for (const far of [550, 1100, 1400]) {
    reset(); wxLive(cleanWx(want)); wxStep(.016, now, m); const k = wxSky(far, far * .11);
    for (const f of ['ovc', 'grey', 'sunK', 'hemiK', 'dark', 'thick']) if (!(k[f] >= 0 && k[f] <= 1)) bad(`${m}: ${f} = ${k[f]}`);
    if (!(k.far >= 150 && k.far <= far && k.near >= 8 && k.near < k.far)) bad(`${m} @${far}: fog ${k.near}..${k.far}`);
    if (m === 'clear' && !(k.sunK > .97 && k.far === far && k.near > far * .1)) bad(`clear day dims the sun or fogs (${JSON.stringify(k)})`);
    if (m === 'storm' && !(k.sunK < .2 && k.far < 800)) bad(`storm is bright or clear (${JSON.stringify(k)})`);
  }

  // ---- wet grip ----
  const sp = { wetg: 1, aqua: 1 };
  if (wetGrip(0, 30, sp) !== 1 || wetGrip(undefined, 30, sp) !== 1 || wetGrip(0, 50, sp, .6, 1) !== 1) bad('a dry road changes the grip');
  for (let v = 0; v <= 80; v += 4) { let p = 1; for (let w = .1; w <= 1.001; w += .1) { const g = wetGrip(w, v, sp); if (g > p + 1e-9 || !(g > .25 && g < 1)) bad(`grip not falling with wetness at ${v} m/s (wet ${w.toFixed(1)}: ${g})`); p = g; } }
  for (const w of [.3, .7, 1]) { let p = 1; for (let v = 0; v <= 80; v += 2) { const g = wetGrip(w, v, sp); if (g > p + 1e-9) bad(`grip rising with speed (wet ${w})`); p = g; } }
  if (!(wetGrip(1, 10, sp, 1, 1) < wetGrip(1, 10, sp) && wetGrip(1, 10, sp, .62) < wetGrip(1, 10, sp))) bad('paint / mud not slicker than wet asphalt');
  if (!(wetGrip(.5, 40, sp) === wetGrip(.5, 5, sp))) bad('hydroplaning on a merely damp road');
  // every bike's tyre table (maker/parts-gen.mjs): the skinny tyre aquaplanes later, the widest and the racing ones sooner
  for (const id of bikeIds) {
    const o = loadBike(id).parts.tires?.o || [], by = n => o.find(x => x.n.startsWith(n));
    const sk = by('Thai concept skinny'), fat = by('Wide fat'), soft = by('Racing soft') || o[o.length - 1];
    if (sk && !(sk.aqua > 1 && sk.wetg > 1)) bad(`${id}: skinny tyre has no wet advantage`);
    if (fat && !(fat.aqua < 1)) bad(`${id}: wide fat tyre does not hydroplane sooner`);
    if (o.length > 1 && !(soft.wetg < 1)) bad(`${id}: "${soft.n}" is not worse in the wet`);
  }
  return { problems: P, info };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, info } = weatherTests(); for (const p of problems) console.log('FAIL  ' + p);
  if (verbose) console.log(info.join(' · '));
  if (process.argv.includes('--live')) {
    try { const r = await fetch(SV.WX_URL), s = SV.wxFromOpenMeteo(await r.json()); console.log('live: ' + JSON.stringify(s) + ' -> ' + JSON.stringify(W.wxDerive(s), (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)); }
    catch (e) { console.log('live: could not reach Open-Meteo (' + e.message + ')'); }
  }
  console.log(problems.length ? `weather: ${problems.length} problem(s)` : 'weather: ok (relay snapshot, modes, road wetness, lightning, sky values, wet grip)');
  process.exit(problems.length ? 1 : 0);
}
