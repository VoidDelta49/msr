#!/usr/bin/env node
// One command for "did I break anything": static checks + headless physics invariants + diff against tools/baseline.json.
//   node tools/test.mjs              run everything (~3 s), prints only problems + a summary line
//   node tools/test.mjs --update     accept the current physics numbers as the new baseline (do this after an INTENDED physics change)
//   node tools/test.mjs --no-check   skip the static checks
// Exit code 0 = pass. Baseline drift is reported as DRIFT lines (fails the run): relative tolerance 4% (absolute floor per metric),
// so a refactor that should not change the feel shows up immediately, and an intended tweak is one --update away.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bikeIds } from './lib/headless.mjs';
import { SCENARIOS, runScenario } from './sim.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url)), BASE = path.join(dir, 'baseline.json');
const update = process.argv.includes('--update'), problems = [];
if (!process.argv.includes('--no-check')) {
  const r = spawnSync(process.execPath, [path.join(dir, 'check.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) { process.stdout.write(r.stdout); problems.push('static checks failed'); } else process.stdout.write(r.stdout.split('\n').filter(l => l.startsWith('WARN')).join('\n') + (r.stdout.includes('WARN') ? '\n' : ''));
}

const res = {};
for (const b of bikeIds) for (const s of SCENARIOS) {
  try { (res[b] ||= {})[s] = runScenario(s, b); } catch (e) { problems.push(`${b} ${s}: threw ${e.message}`); }
}

// invariants: things that must hold for every bike regardless of tuning
const bad = (b, s, msg) => problems.push(`INVARIANT ${b} ${s}: ${msg}`);
for (const b of bikeIds) {
  const R = res[b] || {};
  for (const [s, m] of Object.entries(R)) if (m && m.nan) bad(b, s, `state value ${m.nan} went non-finite`);
  const L = R.launch; if (L) { if (!(L.top > 40)) bad(b, 'launch', `top speed ${L.top} km/h`); if (!(L.t60 > 0 && L.t60 < 30)) bad(b, 'launch', `0-60 = ${L.t60}`); if (L.t100 != null && L.t100 <= L.t60) bad(b, 'launch', '0-100 before 0-60'); if (L.wpMax > 20) bad(b, 'launch', `stock launch lifts the front ${L.wpMax} deg`); }
  const T = R.start; if (T && !(T.ok && T.catch < 4)) bad(b, 'start', `engine did not catch (${JSON.stringify(T)})`);
  const I = R.idle; if (I && !(I.ok && Math.abs(I.rpm - I.idleSpec) < .35 * I.idleSpec && I.v < .2)) bad(b, 'idle', `idle not steady (${JSON.stringify(I)})`);
  const K = R.brake; if (K && !(K.fullM > 3 && K.fullM < 60 && K.halfM > K.fullM)) bad(b, 'brake', `implausible stopping distances (${K.fullM} m full, ${K.halfM} m half)`);
  if (K && K.stoppie > 15) bad(b, 'brake', `stock bike stands on its nose (${K.stoppie} deg)`);
  const W = R.wheelie; if (W && W.wcOn > 15) bad(b, 'wheelie', `wheelie control let the nose up ${W.wcOn} deg`);
  const Z = R.iss; if (Z && !Z.na && !(Z.offAt > 2.5 && Z.offAt < 4 && Z.restarted)) bad(b, 'iss', `idling stop misbehaves (${JSON.stringify(Z)})`);
}

// baseline
const flat = {}; for (const [b, S] of Object.entries(res)) for (const [s, m] of Object.entries(S)) for (const [k, v] of Object.entries(m)) if (typeof v === 'number') flat[`${b}.${s}.${k}`] = v;
if (update) { writeFileSync(BASE, JSON.stringify(flat, null, 0).replace(/,"/g, ',\n"') + '\n'); console.log(`baseline updated: ${Object.keys(flat).length} numbers`); }
else if (!existsSync(BASE)) problems.push('no baseline.json (run: node tools/test.mjs --update)');
else {
  const old = JSON.parse(readFileSync(BASE, 'utf8')); let drift = 0;
  for (const [k, v] of Object.entries(flat)) {
    if (!(k in old)) { problems.push(`DRIFT ${k}: new metric ${v} (not in baseline)`); drift++; continue; }
    const o = old[k], tol = Math.max(Math.abs(o) * .04, k.endsWith('.t') || /\.(catch|offAt|t\d+m?|full[TM]|half[TM])$/.test(k) ? .08 : .6);
    if (Math.abs(v - o) > tol) { problems.push(`DRIFT ${k}: ${o} -> ${v}`); drift++; }
  }
  for (const k of Object.keys(old)) if (!(k in flat)) problems.push(`DRIFT ${k}: metric disappeared (was ${old[k]})`);
}
const shown = problems.slice(0, 25); for (const p of shown) console.log('FAIL  ' + p); if (problems.length > shown.length) console.log(`...and ${problems.length - shown.length} more (node tools/sim.mjs <bike> <scenario> to look closer)`);
console.log(problems.length ? `test: ${problems.length} problem(s)` : `test: ok (${bikeIds.length} bikes x ${SCENARIOS.length} scenarios${update ? ', baseline updated' : ', matches baseline'})`);
process.exit(problems.length ? 1 : 0);
