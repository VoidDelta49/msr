#!/usr/bin/env node
// Bike report and comparison: use it when adding or tuning a bike, to compare against the existing ones (CLAUDE.md asks for that).
//   node tools/bike.mjs                 one-row-per-bike table: mass, power, power/weight, gearing top speed, sim 0-60, 100 m, top, braking, idle, sound outliers
//   node tools/bike.mjs <id>            full report for one bike: spec, drivetrain stats, sim scenarios, sound.parts vs the other bikes, parts list
import { bikeIds, loadAll, computeSpec, DRIVES, ctx, S } from './lib/headless.mjs';
import { runScenario } from './sim.mjs';

const all = loadAll(), id = process.argv[2], f1 = v => (Math.round(v * 10) / 10), pad = (s, n) => String(s ?? '-').padEnd(n);
const med = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const row = bid => { const b = all[bid], sp = computeSpec(b, b.defaults), L = runScenario('launch', bid), B = runScenario('brake', bid); ctx.drive = DRIVES[b.drivetrain];
  return { id: bid, type: b.drivetrain, m: sp.m, ps: sp.peakPS, pw: f1(sp.peakPS / sp.m * 100), gear: Math.round(DRIVES[b.drivetrain].top(sp)), t60: L.t60, m100: L.t100m, top: L.top, stop: B.fullM, hz: sp.red, lw: f1(sp.wb) }; };
// sound.parts: where does a bike sit relative to the median of the others (flag > 3x or < 1/3 for non-zero values)
function soundOutliers(bid) {
  const out = [], mine = all[bid].sound.parts || {};
  for (const [k, v] of Object.entries(mine)) { const others = bikeIds.filter(x => x !== bid && all[x].sound.parts && k in all[x].sound.parts).map(x => all[x].sound.parts[k]); if (!others.length) continue; const m = med(others); if (m > 0 && v > 0 && (v > 3 * m || v < m / 3)) out.push(`${k} ${v} (others ${f1(m * 100) / 100})`); else if (m > 0 && v === 0) out.push(`${k} 0 (others ${f1(m * 100) / 100})`); }
  return out;
}
if (!id) {
  console.log(pad('bike', 10) + pad('drive', 7) + pad('kg', 5) + pad('PS', 6) + pad('PS/100kg', 9) + pad('gear km/h', 10) + pad('0-60', 6) + pad('100m', 6) + pad('top', 7) + pad('stop60 m', 9) + 'sound outliers');
  for (const b of bikeIds) { const r = row(b); console.log(pad(r.id, 10) + pad(r.type, 7) + pad(r.m, 5) + pad(r.ps, 6) + pad(r.pw, 9) + pad(r.gear, 10) + pad(r.t60, 6) + pad(r.m100, 6) + pad(r.top, 7) + pad(r.stop, 9) + soundOutliers(b).join(', ')); }
} else {
  const b = all[id]; if (!b) { console.error('unknown bike ' + id + ' (have: ' + bikeIds.join(', ') + ')'); process.exit(2); }
  const sp = computeSpec(b, b.defaults); ctx.drive = DRIVES[b.drivetrain];
  console.log(`${b.name} [${id}] ${b.drivetrain}, model ${b.model}, cluster ${b.cluster}${sp.sc ? ', sidecar' : ''}${sp.abs ? ', ABS' : ''}${sp.carb ? ', carburettor' : ''}`);
  console.log(`mass ${sp.m} kg · wheelbase ${sp.wb} m (lf ${sp.lf}/lr ${sp.lr}) · CG ${sp.h} m · ${sp.peakPS} PS (${f1(sp.peakPS / sp.m * 100)} PS/100kg) · idle ${sp.idle} / red ${sp.red} / tach ${sp.tachMax} · peak torque ${f1(sp.tqMax)} Nm · tank ${sp.fuel.cap}`);
  console.log(DRIVES[b.drivetrain].stats(sp, b.defaults).replace(/<br>/g, '\n'));
  for (const s of ['launch', 'start', 'brake', 'corner', 'wheelie', 'idle', 'iss', 'stall']) console.log(s.padEnd(8) + Object.entries(runScenario(s, id)).map(([k, v]) => `${k}=${v}`).join(' '));
  const so = soundOutliers(id); console.log('sound.parts: ' + Object.entries(b.sound.parts || {}).map(([k, v]) => `${k}=${v}`).join(' ')); console.log(so.length ? 'differs a lot from the other bikes: ' + so.join(', ') + '  (fine if it matches the real bike)' : 'sound.parts are within 3x of the other bikes everywhere');
  console.log(`garage: ${Object.keys(b.parts).length} parts (${Object.entries(b.parts).map(([k, p]) => k + ':' + p.o.length).join(' ')}), ${b.sliders.length} sliders, ${b.toggles.length} toggles`);
}
