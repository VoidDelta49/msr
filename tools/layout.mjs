#!/usr/bin/env node
// Touch / HUD layout sweep (no browser): runs js/layoutcalc.js over common phone viewports, both orientations, with and
// without notch / home-bar safe-area insets, every bike control scheme (manual, scooter, rotary), right- and left-handed,
// gauge on / off, readout on / off and the touch-size slider extremes. A combination fails when two on-screen controls
// overlap, one leaves the safe area, the layout had to shrink below the floor, or (at default size) a control ends up
// smaller than a usable touch target.
//   node tools/layout.mjs [-v]        -v lists the smallest fit factors; --size WxH checks one viewport and prints its rectangles
import { solve, GAP, hit } from '../js/layoutcalc.js';
import { PHONES, NO_NOTCH, insFor } from './lib/phones.mjs';

const argv = process.argv.slice(2), verbose = argv.includes('-v');
const SCHEMES = { manual: {}, scooter: { cvt: true }, yecvt: { cvt: true, ysh: true }, rotary: { nocl: true } };
const rows = [], fails = [];
function run(name, W, H) {
  for (const notch of NO_NOTCH.has(name.slice(0, -2)) ? [false] : [false, true]) for (const [sc, so] of Object.entries(SCHEMES)) for (const lefty of [false, true]) for (const cam3 of [false, true]) for (const k of [.7, 1, 1.4]) for (const perf of [true, false]) {
    const o = { k, touch: true, lefty, cam3, perf, ...so }, ins = insFor(W, H, notch), res = solve(W, H, ins, o);
    const tag = `${name} ${W}x${H}${notch ? ' notch' : ''} ${sc}${lefty ? ' lefty' : ''}${cam3 ? ' cam3' : ''} k=${k}${perf ? '' : ' noperf'}`;
    rows.push({ tag, f: res.f, mode: res.mode });
    if (!res.ok) { fails.push(`${tag}: ${res.why} (at f=${res.f})`); continue; }
    // double check independently of the solver's own check
    const names = Object.keys(res.rects).filter(n => res.rects[n]);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (hit(res.rects[names[i]], res.rects[names[j]], GAP - .01)) fails.push(`${tag}: ${names[i]} overlaps ${names[j]}`);
    for (const n of names) { const a = res.rects[n]; if (a.x < ins.l - .01 || a.y < ins.t - .01 || a.x + a.w > W - ins.r + .01 || a.y + a.h > H - ins.b + .01) fails.push(`${tag}: ${n} outside the safe area`); }
    if (k === 1) for (const n of ['wheel', 'thr', 'brk', 'clu', 'shift', 'lb']) { const a = res.rects[n]; if (a && Math.min(a.w, a.h) < 40) fails.push(`${tag}: ${n} is ${Math.round(a.w)}x${Math.round(a.h)}, smaller than a touch target`); }
    if (res.rects.gauge && cam3 === false) fails.push(`${tag}: gauge placed while off`);
    if (cam3 && !res.rects.gauge) fails.push(`${tag}: gauge missing`);
  }
}
const one = argv.indexOf('--size');
if (one >= 0) {
  const [W, H] = argv[one + 1].split('x').map(Number), res = solve(W, H, insFor(W, H, argv.includes('--notch')), { k: 1, touch: true, lefty: argv.includes('--lefty'), cam3: true, perf: true, cvt: argv.includes('--cvt') });
  console.log(res.ok ? `ok  f=${res.f} mode=${res.mode}` : `NOT OK ${res.why}`); for (const [n, r] of Object.entries(res.rects)) if (r) console.log(n.padEnd(7), [r.x, r.y, r.w, r.h].map(v => Math.round(v)).join(' ')); process.exit(res.ok ? 0 : 1);
}
for (const [n, [w, h]] of Object.entries(PHONES)) { run(n + ' P', w, h); run(n + ' L', h, w); }
const small = rows.filter(r => r.f < 1).sort((a, b) => a.f - b.f);
if (verbose) for (const r of small.slice(0, 15)) console.log(`f=${r.f}  ${r.mode}  ${r.tag}`);
for (const f of fails.slice(0, +(process.env.LIM||30))) console.log('FAIL  ' + f); if (fails.length > 30) console.log(`...and ${fails.length - 30} more`);
console.log(fails.length ? `layout: ${fails.length} problem(s)` : `layout: ok (${rows.length} combinations over ${Object.keys(PHONES).length * 2} viewports; ${small.length} needed shrinking, smallest fit factor ${(small[0] || { f: 1 }).f})`);
process.exit(fails.length ? 1 : 0);
