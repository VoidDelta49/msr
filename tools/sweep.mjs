#!/usr/bin/env node
// Garage sweep: every part option, every slider at its min and max, every toggle flipped, one at a time, through launch + brake on the real
// solver. Flags NaNs, crashes and implausible jumps relative to the stock bike, so a bad number in a new part option or slider range is caught.
//   node tools/sweep.mjs [bike|all] [-v]       -v prints every variant, otherwise only flagged ones
// Flags (FAIL): non-finite state, exception, top speed outside 0.6x..1.6x stock, 0-60 outside 0.5x..2x, stopping distance outside 0.5x..2x.
import { bikeIds, loadBike } from './lib/headless.mjs';
import { runScenario } from './sim.mjs';

const a = process.argv.slice(2), v = a.includes('-v'), pos = a.filter(x => !x.startsWith('-'));
const bikes = !pos[0] || pos[0] === 'all' ? bikeIds : pos[0].split(',');
const measure = (id, o) => { const L = runScenario('launch', id, o), B = runScenario('brake', id, o); return { top: L.top, t60: L.t60, stop: B.fullM, nan: L.nan || B.nan }; };
let bad = 0, n = 0;
for (const id of bikes) {
  const b = loadBike(id), base = measure(id, {}), vars = [];
  for (const [k, p] of Object.entries(b.parts || {})) p.o.forEach((o, i) => { if (i !== b.defaults[k]) vars.push([`${k}=${i}${o.n ? ' (' + o.n + ')' : ''}`, { parts: { [k]: i } }]); });
  for (const s of b.sliders || []) for (const x of [s.min, s.max]) if (x !== b.defaults[s.k]) vars.push([`${s.k}=${x}`, { set: { [s.k]: x } }]);
  for (const t of b.toggles || []) vars.push([`${t.k}=${!b.defaults[t.k]}`, { set: { [t.k]: !b.defaults[t.k] } }]);
  for (const [name, o] of vars) {
    n++; let m, why = [];
    try { m = measure(id, o); } catch (e) { m = null; why.push('threw ' + String(e.message).slice(0, 80)); }
    if (m) {
      if (m.nan) why.push(`non-finite ${m.nan}`);
      if (!(m.top > .6 * base.top && m.top < 1.6 * base.top)) why.push(`top ${base.top}->${m.top}`);
      if (m.t60 != null && base.t60 != null && !(m.t60 > .5 * base.t60 && m.t60 < 2 * base.t60)) why.push(`0-60 ${base.t60}->${m.t60}`);
      if (m.t60 == null && base.t60 != null) why.push('never reaches 60 km/h');
      if (!(m.stop > .5 * base.stop && m.stop < 2 * base.stop)) why.push(`stop ${base.stop}->${m.stop} m`);
    }
    if (why.length) { bad++; console.log(`FAIL  ${id} ${name}: ${why.join('; ')}`); }
    else if (v) console.log(`      ${id.padEnd(9)} ${name.padEnd(28)} top ${m.top} (${base.top})  0-60 ${m.t60} (${base.t60})  stop ${m.stop} m (${base.stop})`);
  }
}
console.log(bad ? `sweep: ${bad} flagged of ${n} variants` : `sweep: ok (${n} variants over ${bikes.length} bikes)`);
process.exit(bad ? 1 : 0);
