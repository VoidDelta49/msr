#!/usr/bin/env node
// Headless checks of the light probe grid (js/probes.js; the game glue is js/probefig.js). No browser; three's core build for Vector3.
//   node tools/probes.mjs [-v]     (also part of tools/test.mjs)
// Fails on: the SH projection not reproducing known irradiance (uniform environment, sky over black ground, a single direction),
// the trilinear lookup (exact at probes, the mean in the middle, linear along an edge, clamped outside, missing probes fading to the
// neutral probe, terrain-following layers), the throttle (resampling only after moving / when probes change, at most every N frames,
// the eased output converging, a forced resample being exact), the pool (evicted probes reused, no new objects once warm), the JSON
// format round trip, the demo biomes (tunnel blocks the sky and is lit from above in sodium orange, neon is magenta / cyan by side).
import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), J = rel => pathToFileURL(path.join(ROOT, rel)).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === 'three' ? { url: ${JSON.stringify(J('vendor/three/build/three.core.js'))}, shortCircuit: true } : n(s, c); }`));
const { Vector3 } = await import(J('vendor/three/build/three.core.js'));
const PR = await import(J('js/probes.js'));
const verbose = process.argv.includes('-v');

export function probeTests() {
  const P = [], bad = m => P.push('PROBES ' + m), info = [], { LightProbeGrid, project, mkProbe, evalSH, demoGrid, BIOMES, FALLBACK } = PR;
  const near = (a, b, e = .03) => Math.abs(a - b) <= e, V = new Vector3(), f3 = v => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

  // ---- projection: known irradiance ----
  { const p = project(mkProbe(), 0, 0, 0, (x, y, z, dx, dy, dz, o) => { o.set(.5, .25, 1); return 1; }, 64);
    if (!near(p.shAmbient.x, .5, 1e-6) || !near(p.shAmbient.z, 1, 1e-6) || p.shX.length() > .02 || p.shY.length() > .02 || p.shZ.length() > .02 || !near(p.vis, 1, 1e-9)) bad(`uniform environment gave ambient ${f3(p.shAmbient)} x ${f3(p.shX)} y ${f3(p.shY)} vis ${p.vis}`);
    for (const [nx, ny, nz] of [[1, 0, 0], [0, -1, 0], [.6, 0, .8]]) { evalSH(p, nx, ny, nz, V); if (!near(V.x, .5) || !near(V.y, .25) || !near(V.z, 1)) bad(`uniform environment: light toward (${nx}, ${ny}, ${nz}) is ${f3(V)}`); } }
  { const p = project(mkProbe(), 0, 0, 0, (x, y, z, dx, dy, dz, o) => { if (dy > 0) o.set(1, 1, 1); return 1; }, 96); // white sky over black ground
    const up = evalSH(p, 0, 1, 0, new Vector3()).x, dn = evalSH(p, 0, -1, 0, new Vector3()).x, side = evalSH(p, 1, 0, 0, new Vector3()).x;
    if (!near(up, 1, .04) || !near(dn, 0, .04) || !near(side, .5, .04)) bad(`sky over black ground: up ${up.toFixed(3)} (1), down ${dn.toFixed(3)} (0), side ${side.toFixed(3)} (.5)`);
    info.push(`sky/ground up ${up.toFixed(3)} down ${dn.toFixed(3)}`); }
  { const p = project(mkProbe(), 0, 0, 0, (x, y, z, dx, dy, dz, o) => { if (dx > .9) o.set(1, 0, 0); return dy > 0 ? 0 : 1; }, 128); // a small red source on +x, no sky
    if (!(p.shX.x > 0) || !(evalSH(p, 1, 0, 0, V).x > evalSH(p, -1, 0, 0, new Vector3()).x) || p.vis !== 0) bad(`a source on +x does not light +x faces more (shX ${f3(p.shX)}, vis ${p.vis})`); }

  // ---- trilinear lookup ----
  const g = new LightProbeGrid({ gridOrigin: new Vector3(10, 0, 20), cellSize: 2, dimensions: { x: 2, y: 2, z: 2 } });
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const p = g.ensure(i, j, k); p.shAmbient.set(i, j, k); p.shX.set(i + j + k, 0, 0); p.vis = 1 - .5 * i; }
  const s = mkProbe();
  g.sampleAt(new Vector3(12, 2, 20), s); if (!near(s.shAmbient.x, 1, 1e-9) || !near(s.shAmbient.y, 1, 1e-9) || !near(s.shAmbient.z, 0, 1e-9) || !near(s.vis, .5, 1e-9)) bad(`lookup at probe (1, 1, 0) gave ${f3(s.shAmbient)} vis ${s.vis}`);
  g.sampleAt(new Vector3(11, 1, 21), s); if (!near(s.shAmbient.x, .5, 1e-9) || !near(s.shAmbient.y, .5, 1e-9) || !near(s.shAmbient.z, .5, 1e-9) || !near(s.shX.x, 1.5, 1e-9) || !near(s.vis, .75, 1e-9)) bad(`lookup in the middle gave ${f3(s.shAmbient)} shX ${s.shX.x} vis ${s.vis} (the mean)`);
  g.sampleAt(new Vector3(10.5, 0, 20), s); if (!near(s.shAmbient.x, .25, 1e-9)) bad(`lookup a quarter along an edge gave ${s.shAmbient.x} (.25)`);
  g.sampleAt(new Vector3(-50, -9, 99), s); if (!near(s.shAmbient.x, 0, 1e-9) || !near(s.shAmbient.z, 1, 1e-9)) bad(`lookup outside the grid is not clamped to the edge probe: ${f3(s.shAmbient)}`);
  g.remove(1, 1, 1); g.sampleAt(new Vector3(11, 1, 21), s); if (!near(s.shAmbient.x, .375, 1e-9) || !near(s.vis, .75 + .125 * (1 - .5), 1e-9)) bad(`a missing probe does not count as the neutral one: ${f3(s.shAmbient)} vis ${s.vis}`);
  g.sampleAt(new Vector3(12, 2, 22), s); if (s.shAmbient.length() > 1e-9 || s.vis !== 1) bad('at a missing probe the lookup is not exactly neutral');
  if (FALLBACK.shAmbient.length() || FALLBACK.vis !== 1) bad('FALLBACK was written to');
  { const tg = new LightProbeGrid({ gridOrigin: new Vector3(0, 1, 0), cellSize: { x: 4, y: 4, z: 4 }, dimensions: { x: 3, y: 2, z: 3 }, groundFn: (x, z) => 100 + x });
    for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) { tg.ensure(i, 0, k).shAmbient.set(1, 0, 0); tg.ensure(i, 1, k).shAmbient.set(0, 1, 0); }
    tg.sampleAt(new Vector3(4, 104 + 3, 4), s); if (!near(s.shAmbient.x, .5, 1e-9) || !near(s.shAmbient.y, .5, 1e-9)) bad(`terrain-following layers: 3 m above ground (between the 1 m and 5 m layers) gave ${f3(s.shAmbient)}`);
    tg.probeWorldPos(2, 1, 0, V); if (!near(V.y, 108 + 5, 1e-9)) bad(`probe world height with groundFn is ${V.y} (113)`); }

  // ---- throttle + easing ----
  { const tg = new LightProbeGrid({ cellSize: 10, dimensions: { x: 2, y: 1, z: 1 } }); tg.ensure(0, 0, 0).shAmbient.set(0, 0, 0); tg.ensure(1, 0, 0).shAmbient.set(1, 1, 1);
    tg.every = 3; tg.moveEps = .5; tg.ease = .5; const pos = new Vector3(0, 0, 0), L = tg.update(pos, true), S0 = tg.sample;
    if (L !== tg.light || L.shAmbient.x !== 0) bad('forced update is not exact'); let samples = 0; const orig = tg.sampleAt.bind(tg); tg.sampleAt = (p, o) => { samples++; return orig(p, o); };
    for (let f = 0; f < 6; f++) tg.update(pos); if (samples) bad(`parked: ${samples} lookups in 6 frames (0)`);
    pos.x = .3; for (let f = 0; f < 6; f++) tg.update(pos); if (samples) bad(`moved .3 m (< moveEps): ${samples} lookups`);
    pos.x = 5; samples = 0; for (let f = 0; f < 9; f++) { pos.x += .6; tg.update(pos); } if (samples < 2 || samples > 3) bad(`moving every frame: ${samples} lookups in 9 frames (every 3rd: 3)`);
    for (let f = 0; f < 30; f++) tg.update(pos); if (!near(tg.light.shAmbient.x, tg.sample.shAmbient.x, 1e-4)) bad(`eased light does not converge: ${tg.light.shAmbient.x} vs ${tg.sample.shAmbient.x}`);
    if (tg.sample !== S0) bad('update replaced the sample object (must reuse)');
    samples = 0; tg.ensure(0, 0, 0).shAmbient.set(.2, .2, .2); tg.version++; for (let f = 0; f < 4; f++) tg.update(pos); if (samples !== 1) bad(`changed probes while parked: ${samples} lookups (1)`); }

  // ---- pool: streaming allocates nothing once warm ----
  { const tg = new LightProbeGrid({ dimensions: { x: 50, y: 1, z: 50 } }), seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(tg.ensure(i, 0, 0)); for (let i = 0; i < 20; i++) tg.remove(i, 0, 0);
    let fresh = 0; for (let i = 0; i < 20; i++) if (!seen.has(tg.ensure(i, 0, 5))) fresh++; if (fresh) bad(`${fresh} new probe objects after eviction (pool not reused)`);
    if (tg.ensure(60, 0, 0) !== null || tg.get(-1, 0, 0) !== null) bad('cells outside the grid are not refused');
    if (tg.ensure(3, 0, 5).shAmbient.length() !== 0 || tg.ensure(3, 0, 5).vis !== 1) bad('a pooled probe comes back dirty'); }

  // ---- JSON round trip ----
  { const a = demoGrid(0, 0, { span: 48, cell: 8, layers: 2 }), b = LightProbeGrid.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
    if (b.size !== a.size) bad(`JSON: ${b.size} probes back of ${a.size}`); let worst = 0; const pa = new Vector3(), q = mkProbe(), r = mkProbe();
    for (const [x, z] of [[3, 5], [-17, 9], [20, -20]]) { pa.set(x, 2, z); a.sampleAt(pa, q); b.sampleAt(pa, r); worst = Math.max(worst, q.shAmbient.distanceTo(r.shAmbient), q.shY.distanceTo(r.shY), Math.abs(q.vis - r.vis)); }
    if (worst > 1e-3) bad(`JSON round trip changed the lookup by ${worst}`); info.push(`demo 48 m: ${a.size} probes, JSON ${JSON.stringify(a.toJSON()).length} bytes`); }

  // ---- demo biomes ----
  { const p = project(mkProbe(), 0, 0, 0, BIOMES.tunnel, 48), up = evalSH(p, 0, 1, 0, new Vector3()), dn = evalSH(p, 0, -1, 0, new Vector3());
    if (p.vis > .01) bad(`tunnel sees the sky (vis ${p.vis})`); if (!(up.x > up.z * 2 && up.x > dn.x * 2)) bad(`tunnel is not lit sodium-orange from above: up ${f3(up)} down ${f3(dn)}`);
    const n = project(mkProbe(), 0, 0, 0, BIOMES.neon, 48), px = evalSH(n, 1, 0, 0, new Vector3()), mx = evalSH(n, -1, 0, 0, new Vector3());
    if (!(px.x > px.y * 2 && mx.z > mx.x * 2)) bad(`neon is not magenta on +x / cyan on -x: ${f3(px)} / ${f3(mx)}`); if (n.vis < .5) bad(`neon street sky mostly blocked (vis ${n.vis})`);
    const c = project(mkProbe(), 0, 0, 0, BIOMES.canyon, 48); if (!(c.vis < .5 && c.shAmbient.x > c.shAmbient.z)) bad(`canyon: vis ${c.vis}, ambient ${f3(c.shAmbient)}`);
    info.push(`tunnel up ${f3(up)} · neon +x ${f3(px)} -x ${f3(mx)} · canyon vis ${c.vis.toFixed(2)}`); }

  // ---- cost ----
  { const tg = demoGrid(0, 0, { span: 240, cell: 8, layers: 2 }), pos = new Vector3(), t0 = performance.now(); for (let i = 0; i < 2e5; i++) { pos.set(Math.sin(i) * 100, 1, Math.cos(i * .7) * 100); tg.sampleAt(pos); }
    const us = (performance.now() - t0) / 2e5 * 1e3; info.push(`sampleAt ${us.toFixed(2)} µs`); if (us > 20) bad(`sampleAt takes ${us.toFixed(1)} µs (a lookup should be ~1 µs)`); }
  return { problems: P, info };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, info } = probeTests(); for (const p of problems) console.log('FAIL  ' + p); if (verbose) console.log(info.join(' · '));
  console.log(problems.length ? `probes: ${problems.length} problem(s)` : 'probes: ok (SH projection, trilinear lookup, throttle, pool, JSON, demo biomes)');
  process.exit(problems.length ? 1 : 0);
}
