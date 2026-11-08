// In-game benchmark (Options > System > BENCHMARK). Arms a reload (GPU timers can only be switched on when the renderer is made),
// the menu's PLAY button then starts a scripted ride: the bike is placed along a road each frame at a set speed, so every run
// sees the same scenery, and the real loop (physics, visuals, audio, HUD, cull, draw) runs around it. Per frame it records the
// interval, the CPU time of each stage, GPU pass time (WebGPU timestamp queries / WebGL timer queries where the device has them),
// draw calls and which events happened (shadow-map refresh, dash upload, GC, environment bake). Phases 1-4 are real riding
// situations; 5-10 repeat one steady 100 km/h stretch with things switched off (shadow-map updates, post-processing, half resolution,
// all three) to price each one, and once more at the end to see thermal throttling. The report is plain text, saved to
// localStorage (cpmBench) for the System tab to show and copy; main.js feeds it through benchDrive() / benchFrame().
import { cfg, BUILD } from './config.js';
import { S, ctx } from './state.js';
import { renderer, sun, camera, PC, BX, setDPR, API } from './renderer.js';
import { ROADS, roadH } from './world.js';
import { $ } from './util.js';

export const BN = { on: false };

const PHASES = [ // v: km/h (number, or [from, to] ramped over the phase), cam: 1 third person / 0 first, a: ablation (A), secs measured, warm secs discarded
  { id: 'park', name: 'Parked in town', route: 'town', v: 0, cam: 1, secs: 4, warm: 1 },
  { id: 'town', name: 'Town, 40 km/h', route: 'town', v: 40, cam: 1, secs: 7, warm: 1 },
  { id: 'hwy', name: 'Highway, 40 to 110 km/h', route: 'hwy', v: [40, 110], cam: 1, secs: 9, warm: 1 },
  { id: 'fp', name: 'Highway, first person (dash)', route: 'hwy', v: [40, 110], cam: 0, secs: 7, warm: 1 },
  { id: 'a0', name: 'Steady 100 km/h (reference)', route: 'hwy', v: 100, cam: 1, secs: 5, warm: 1, a: 'ref' },
  { id: 'a1', name: '... shadow-map updates off', route: 'hwy', v: 100, cam: 1, secs: 5, warm: 2, a: 'noshadow' },
  { id: 'a2', name: '... post-processing off', route: 'hwy', v: 100, cam: 1, secs: 5, warm: 2, a: 'nopost' },
  { id: 'a3', name: '... half resolution', route: 'hwy', v: 100, cam: 1, secs: 5, warm: 2, a: 'halfres' },
  { id: 'a4', name: '... all three off (CPU floor)', route: 'hwy', v: 100, cam: 1, secs: 5, warm: 2, a: 'floor' },
  { id: 'a0b', name: 'Reference again (throttle check)', route: 'hwy', v: 100, cam: 1, secs: 5, warm: 2, a: 'ref' },
];
const A = { ref: [1, 1, 1], noshadow: [0, 1, 1], nopost: [1, 0, 1], halfres: [1, 1, .5], floor: [0, 0, .5] }; // shadows, post chain, resolution scale

let ST = null, CB = {}; // run state, callbacks from main.js
export const benchInit = cb => { CB = cb; };

/* ---------- recording ---------- */
const MAXF = 8000, mk = () => new Float32Array(MAXF);
const F_IV = mk(), F_CPU = mk(), F_PHY = mk(), F_VIS = mk(), F_AUD = mk(), F_HUD = mk(), F_CUL = mk(), F_DRW = mk(), F_DC = mk(), F_TRI = mk(), F_FL = new Uint8Array(MAXF), G_R = mk(), G_C = mk();
let nF = 0, nR = 0, nC = 0, lastT = 0, lastBake = 0, lastHeap = 0, lastR = -1, lastC = -1, recDist = 0, TS = false;
const MEM = performance.memory;
const FL = { 1: 'shadow refresh', 2: 'dash upload', 4: 'gc', 8: 'env bake' };

/* ---------- routes ---------- */
// a ~300 m stretch of road as points + running distance; town = the street nearest the lot, hwy = a third of the way along the highway
function route(kind) {
  let r, i0 = 0, dir = 1;
  if (kind === 'hwy') { r = ROADS.find(q => q.hwy); i0 = Math.floor(r.s.length / 3); }
  else { let best = 1e9; for (const q of ROADS) { if (q.hwy || q.kind === 'strip') continue; q.s.forEach((p, i) => { const d = Math.hypot(p.x, p.z + 6); if (d < best) { best = d; r = q; i0 = i; } }); } }
  const n = r.s.length, P = [{ x: r.s[i0].x, z: r.s[i0].z }], cum = [0];
  const room = r.closed ? 1e9 : (n - 1 - i0) * 2; if (!r.closed && room < 300 && i0 > room) dir = -1;
  for (let k = 1; cum[cum.length - 1] < 300 && k < n; k++) {
    const i = r.closed ? ((i0 + dir * k) % n + n) % n : i0 + dir * k; if (i < 0 || i >= n) break;
    const p = r.s[i], q = P[P.length - 1]; P.push({ x: p.x, z: p.z }); cum.push(cum[cum.length - 1] + Math.hypot(p.x - q.x, p.z - q.z));
  }
  return { P, cum, k: 0 };
}
function place(R, d) {
  const { P, cum } = R; while (R.k < cum.length - 2 && cum[R.k + 1] < d) R.k++;
  const a = P[R.k], b = P[R.k + 1], L = cum[R.k + 1] - cum[R.k] || 1, f = Math.min(1, Math.max(0, (d - cum[R.k]) / L));
  S.x = a.x + (b.x - a.x) * f; S.z = a.z + (b.z - a.z) * f; S.psi = Math.atan2(b.x - a.x, b.z - a.z);
}

/* ---------- the ride ---------- */
const kmh = (P, el) => { const v = P.v; return (Array.isArray(v) ? v[0] + (v[1] - v[0]) * Math.min(1, el / (P.secs + P.warm)) : v) / 3.6; };
export function benchDrive(dt) { // after the physics block, before the frame is built: this frame's pose
  if (!ST) return;
  const P = PHASES[ST.i], v = kmh(P, ST.el), sp = ctx.spec; ST.dist += v * dt; if (ST.rec) recDist += v * dt;
  place(ST.R, ST.dist); S.v = v; if (ST.fresh) { ST.fresh = false; S.hF = S.hR = roadH(S.x, S.z); S.zH = S.hF + (sp.yf + sp.yr + sp.pf + sp.pr) / 2; camera.position.set(S.x + Math.sin(S.psi) * 4.2, 1.9 + S.zH, S.z + Math.cos(S.psi) * 4.2); } // (the chase camera eases toward the bike a fraction per frame: snap it, or it spends the whole warm-up crossing the island) // chassis height: set at the start, then the physics keeps it (fighting it made the shadow window flicker)
  S.thr = v > 0 ? .6 : 0; S.brake = 0; S.steer = 0; S.cl = 0; S.fuel = sp.fuel.cap; S.crashed = false;
  if (sp.g && sp.type !== 'cvt' && v > 0) { let g = 1; for (let i = 1; i < sp.g.length; i++) { if (v / sp.r * sp.prim * sp.g[i] * sp.final * 30 / Math.PI <= sp.red * .85) { g = i; break; } g = i; } S.gear = g; }
  CB.sync();
}
function enter(i) { // set up phase i: the ablation, the camera, the start of the route
  ST.i = i; const P = PHASES[i], a = A[P.a || 'ref'];
  BX.noShadow = !a[0]; BX.post = !!a[1]; if (renderer._rs !== a[2]) { renderer._rs = a[2]; setDPR(); }
  if (ctx.camMode !== P.cam) CB.toggleCam();
  ST.R = ST.routes[P.route] || (ST.routes[P.route] = route(P.route)); ST.R.k = 0; ST.dist = 0; ST.el = 0; ST.t0 = 0; ST.rec = false; ST.fresh = true; ST.fc = 0; ST.r0 = 0; ST.last = []; nF = nR = nC = 0; recDist = 0; lastR = lastC = -1;
  $('benchT').textContent = `${i + 1}/${PHASES.length}  ${P.name}`; $('benchP').style.width = (i / PHASES.length * 100) + '%';
}

// every frame, end of the loop. t = rAF time, the rest are performance.now() stamps of the loop's stages
export function benchFrame(t, j0, p1, p2, p3, d0, c1, j1, hudUp, shRef) {
  if (!ST) return;
  if (ctx.OPT || ctx.GAR || ctx.paused) return end(false, 'a menu was opened'); // the numbers would be wrong from here on
  if (!ST.t0) { ST.t0 = t; lastT = t; ST.el = 0; return; }
  const P = PHASES[ST.i], iv = t - lastT; lastT = t; ST.el = (t - ST.t0) / 1000;
  ST.fc++; const Lq = ST.last; Lq.push(iv); if (Lq.length > 4) Lq.shift();
  // recording starts after the warm-up time AND some frames AND once frames are no longer stalled (the last 4 within ~3x of each other): an ablation that changes the render
  // target (post-processing off = straight to the canvas, no MSAA) compiles every pipeline again, which can take seconds on a phone
  if (!ST.rec && ST.el >= P.warm && ST.fc >= (P.a && P.a !== 'ref' ? 8 : 5) && Lq.length === 4 && Math.max(...Lq) <= Math.min(...Lq) * 3 + 25) { ST.rec = true; ST.r0 = t; nF = nR = nC = 0; recDist = 0; lastR = lastC = -1; }
  if (ST.rec && nF < MAXF) {
    const i = nF++; F_IV[i] = iv; F_CPU[i] = j1 - j0; F_PHY[i] = p1 - j0; F_VIS[i] = p2 - p1; F_AUD[i] = p3 - p2; F_HUD[i] = d0 - p3; F_CUL[i] = c1 - d0; F_DRW[i] = j1 - c1;
    const info = renderer.info.render; F_DC[i] = info.drawCalls; F_TRI[i] = info.triangles;
    let fl = (shRef ? 1 : 0) | (hudUp ? 2 : 0); if (PC.bake !== lastBake) fl |= 8; if (MEM) { const h = MEM.usedJSHeapSize; if (lastHeap - h > 524288) fl |= 4; lastHeap = h; } lastBake = PC.bake; F_FL[i] = fl;
  }
  if (TS) { // GPU time of the passes since the last resolve (three sums them); keep each new value once
    renderer.resolveTimestampsAsync('render').then(ms => { if (ST && ST.rec && typeof ms === 'number' && ms !== lastR && nR < MAXF) G_R[nR++] = lastR = ms; }).catch(() => { });
    renderer.resolveTimestampsAsync('compute').then(ms => { if (ST && ST.rec && typeof ms === 'number' && ms !== lastC && nC < MAXF) G_C[nC++] = lastC = ms; }).catch(() => { });
  }
  if (t - lastUi > 300) { lastUi = t; $('benchP').style.width = ((ST.i + Math.min(1, ST.el / (P.warm + P.secs))) / PHASES.length * 100) + '%'; }
  // a phase ends after P.secs of RECORDED time (not time since the phase began: a long compile used to eat the measuring window,
  // leaving 12 frames); a phase that never settles gives up after a generous cap and is marked as cut short
  const recS = ST.rec ? (t - ST.r0) / 1000 : 0, cap = ST.el >= (P.warm + P.secs) * 3 + 20;
  if (ST.rec && recS >= P.secs && nF >= 12 || cap) { const r = summary(P); r.cut = recS < P.secs * .8; ST.res.push(r); if (ST.i + 1 < PHASES.length) enter(ST.i + 1); else end(true); }
}
let lastUi = 0;

/* ---------- statistics ---------- */
const r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100;
const avg = (a, n) => { let s = 0; for (let i = 0; i < n; i++) s += a[i]; return n ? s / n : 0; };
const spread = (a, n) => { const s = a.slice(0, n).sort(), q = p => s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; return { avg: r2(avg(a, n)), p50: r2(q(.5)), p95: r2(q(.95)), p99: r2(q(.99)), max: r2(s[s.length - 1] || 0) }; };
function summary(P) {
  const n = nF, iv = spread(F_IV, n), th = iv.p50 * 1.5 + 1.5, H = { n: 0, over33: 0, over50: 0, shadow: 0, dash: 0, gc: 0, bake: 0, cpu: 0, other: 0, plain: 0 }, W = [], fr = { shadow: 0, dash: 0, gc: 0, bake: 0, plain: 0 };
  for (let i = 0; i < n - 1; i++) { const f = F_FL[i]; if (f & 1) fr.shadow++; if (f & 2) fr.dash++; if (f & 4) fr.gc++; if (f & 8) fr.bake++; if (!f) fr.plain++; } // (the last frame has no next frame to judge)
  for (let i = 1; i < n; i++) { // a long frame is blamed on what the PREVIOUS frame's callback did (that is what delayed this one)
    const x = F_IV[i]; if (x > 33.4) H.over33++; if (x > 50) H.over50++; if (x <= th) continue; H.n++; const f = F_FL[i - 1];
    if (f & 1) H.shadow++; if (f & 2) H.dash++; if (f & 4) H.gc++; if (f & 8) H.bake++;
    if (!f) { H.plain++; if (F_CPU[i - 1] > x * .5) H.cpu++; else H.other++; } W.push([x, i - 1]);
  }
  W.sort((a, b) => b[0] - a[0]);
  H.worst = W.slice(0, 3).map(([x, i]) => ({ ms: r1(x), what: [1, 2, 4, 8].filter(b => F_FL[i] & b).map(b => FL[b]).join('+') || '-', cpu: r1(F_CPU[i]), phys: r1(F_PHY[i]), vis: r1(F_VIS[i]), draw: r1(F_DRW[i]) }));
  const cpu = spread(F_CPU, n), sec = n ? n * iv.avg / 1000 : 0;
  return {
    id: P.id, name: P.name, frames: n, secs: r1(sec), iv, fps: r1(iv.avg ? 1000 / iv.avg : 0), refresh: r1(1000 / (spread(F_IV, n).p50 || 16.7)),
    cpu, parts: { phys: r2(avg(F_PHY, n)), vis: r2(avg(F_VIS, n)), aud: r2(avg(F_AUD, n)), hud: r2(avg(F_HUD, n)), cull: r2(avg(F_CUL, n)), draw: r2(avg(F_DRW, n)) },
    gpu: nR ? { render: spread(G_R, nR), compute: nC ? spread(G_C, nC) : null, samples: nR } : null,
    draws: Math.round(avg(F_DC, n)), tris: Math.round(avg(F_TRI, n) / 1000), hitch: H, flagged: fr, metres: Math.round(recDist),
  };
}

/* ---------- report ---------- */
const row = (a, f = 1) => a ? `avg ${a.avg.toFixed(f)}  p50 ${a.p50.toFixed(f)}  p95 ${a.p95.toFixed(f)}  p99 ${a.p99.toFixed(f)}  max ${a.max.toFixed(f)}` : '';
function device(q) {
  const D = { ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, ''), cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory, screen: `${screen.width}x${screen.height} @${devicePixelRatio}`, canvas: `${renderer.domElement.width}x${renderer.domElement.height}`, api: API, gpu: '' };
  try { const ai = renderer.backend.device && renderer.backend.device.adapterInfo; if (ai) D.gpu = [ai.vendor, ai.architecture, ai.device, ai.description].filter(Boolean).join(' / '); } catch (e) { }
  try { const gl = renderer.backend.gl, x = gl && gl.getExtension('WEBGL_debug_renderer_info'); if (x) D.gpu = gl.getParameter(x.UNMASKED_RENDERER_WEBGL); } catch (e) { }
  D.timer = TS ? 'on' : 'not available on this device'; D.quality = cfg.gfx; return D;
}
function verdict(R) {
  const L = [], a0 = R.a0, a0b = R.a0b, g = p => p.gpu ? p.gpu.render.p50 + (p.gpu.compute ? p.gpu.compute.p50 : 0) : null; // median: WebGL's timer can lump two slow frames into one sample, which inflates a mean
  if (a0) {
    const gp = g(a0), cp = a0.cpu.avg, iv = a0.iv.avg;
    if (gp == null) L.push(`GPU timer not available here, so read the "switched off" rows: the frame time they save is the GPU time that feature costs.`);
    else if (gp > iv * .8 && cp > iv * .8) L.push(`GPU and CPU both near the limit at 100 km/h: GPU ${r1(gp)} ms, CPU ${r1(cp)} ms of a ${r1(iv)} ms frame (they run side by side, so either one alone can make a frame miss the display's beat).`);
    else if (gp > iv * .8) L.push(`GPU-bound at 100 km/h: the GPU needs ${r1(gp)} ms of a ${r1(iv)} ms frame (${Math.round(gp / iv * 100)}%).`);
    else if (cp > iv * .8) L.push(`CPU-bound at 100 km/h: the CPU needs ${r1(cp)} ms of a ${r1(iv)} ms frame (${Math.round(cp / iv * 100)}%).`);
    else L.push(`Neither side is the limit at 100 km/h: GPU ${r1(gp)} ms and CPU ${r1(cp)} ms inside a ${r1(iv)} ms frame (headroom ${r1(iv - Math.max(gp, cp))} ms). Frames are waiting on the display or the system.`);
    // Each ablation is compared with the reference as it would have measured at that moment: a straight line from the first reference run
    // (a0) to the last (a0b), since a phone warms up and slows down across the run (a fixed a0 once made shadows "cost -1.3 ms CPU").
    // Switching a feature off can't make the frame slower, so a negative cost is drift or noise, reported as nothing measurable.
    const ab = ['a1', 'a2', 'a3', 'a4'], ok = a0b && !a0b.cut, at = id => ok ? (ab.indexOf(id) + 1) / (ab.length + 1) : 0, lerp = (x, y, f) => x == null || y == null ? x : x + (y - x) * f;
    for (const [id, what] of [['a1', 'Shadow-map updates (receivers still sample the map)'], ['a2', 'Post-processing (grade, AA, filters, motion blur)'], ['a3', 'Full resolution (vs half)']]) {
      const p = R[id]; if (!p || p.cut) continue; const floor = Math.max(.7, a0.iv.avg * .04), f = at(id); // under ~4% of a frame is run-to-run noise
      const m = x => x < floor ? 'nothing measurable' : r1(x) + ' ms', d = [], gi = g(p), gr = ok ? lerp(g(a0), g(a0b), f) : g(a0);
      if (gi != null && gr != null) d.push(`GPU ${m(gr - gi)}`);
      d.push(`CPU ${m(lerp(a0.cpu.avg, ok ? a0b.cpu.avg : a0.cpu.avg, f) - p.cpu.avg)}`, `frame ${m(lerp(a0.iv.avg, ok ? a0b.iv.avg : a0.iv.avg, f) - p.iv.avg)}`); L.push(`${what} cost per frame: ${d.join(', ')}.`);
    }
    // where the CPU time goes when the frame is CPU-heavy: almost all of it is usually the draw stage (three.js work per object)
    if (cp > iv * .6 && a0.parts.draw > cp * .6) L.push(`CPU: ${r1(a0.parts.draw)} of its ${r1(cp)} ms is the draw stage (three.js work per object, ~${a0.draws} draw calls), ${r1(cp - a0.parts.draw)} ms the rest of the frame.`);
    if (R.a4) L.push(`With everything off: frame ${r1(R.a4.iv.avg)} ms, CPU ${r1(R.a4.cpu.avg)} ms${g(R.a4) != null ? `, GPU ${r1(g(R.a4))} ms` : ''}.`);
  }
  if (a0 && a0b) { const f = a0b.iv.avg / a0.iv.avg, gg = g(a0) && g(a0b) ? g(a0b) / g(a0) : f; L.push(`Throttle check: the same stretch took ${r1(a0b.iv.avg)} ms vs ${r1(a0.iv.avg)} ms at the start (${f >= 1 ? '+' : ''}${Math.round((f - 1) * 100)}%)${g(a0) ? `, GPU ${gg >= 1 ? '+' : ''}${Math.round((gg - 1) * 100)}%` : ''}${gg > 1.1 || f > 1.1 ? ': the device is slowing down as it warms up.' : '.'}`); }
  // hitch rate after each kind of event vs after frames with none: a per-event comparison is fair even when an event only happens in
  // one phase (the dash only uploads in first person), which a share-of-all-hitches figure was not
  const T = { n: 0, shadow: 0, dash: 0, gc: 0, bake: 0, cpu: 0, other: 0, plain: 0 }, FR = { frames: 0, shadow: 0, dash: 0, gc: 0, bake: 0, plain: 0 };
  for (const id of ['park', 'town', 'hwy', 'fp', 'a0', 'a0b']) { const p = R[id]; if (!p) continue; for (const k in T) T[k] += p.hitch[k] || 0; FR.frames += p.frames; for (const k of ['shadow', 'dash', 'gc', 'bake', 'plain']) FR[k] += p.flagged[k] || 0; }
  if (T.n) {
    const base = FR.plain ? T.plain / FR.plain : 0, pc = x => Math.round(x * 100) + '%', NM = { shadow: 'shadow refresh', dash: 'dash upload', gc: 'GC', bake: 'env bake' };
    L.push(`Hitches (frames over 1.5x the median): ${T.n} in ${FR.frames} frames; ${pc(base)} of frames with no event are followed by one (slow CPU ${T.cpu}, GPU/system ${T.other}).`);
    const ev = ['shadow', 'dash', 'gc', 'bake'].filter(k => FR[k]).map(k => { const r = T[k] / FR[k], x = base ? r / base : 0; return `${NM[k]} ${pc(r)} of ${FR[k]}${FR[k] < 10 ? ' (too few to tell)' : x > 1.5 ? ` (${r1(x)}x: a real cause)` : ' (about the same: coincidence)'}`; });
    if (ev.length) L.push(`After each event, how often the next frame hitches: ${ev.join(', ')}.`);
  } else L.push('No hitches in the normal-settings phases.');
  const cut = Object.values(R).filter(p => p.cut); if (cut.length) L.push(`Cut short (never settled, too few frames to trust): ${cut.map(p => p.name.replace(/^\.\.\. /, '')).join(', ')}.`);
  return L;
}
function report(R, D) {
  const out = [`CPM Motor benchmark · build ${BUILD} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `Device: ${D.ua}`, `        ${D.cores} cores · ${D.mem ? D.mem + ' GB · ' : ''}screen ${D.screen} · canvas ${D.canvas}`, `Renderer: ${D.api}${D.gpu ? ' · ' + D.gpu : ''} · GPU timer ${D.timer}`,
    `Settings: ${['gfx', 'aa', 'ibl', 'grade', 'nightFx', 'n64', 'mblur', 'mbAmt', 'retro', 'gpuCull', 'forceGL', 'bike'].map(k => k + '=' + cfg[k]).join(' ')} (test runs at noon, uncapped, auto-res off, Tough mode on)`, '', 'VERDICT', ...verdict(Object.fromEntries(R.map(p => [p.id, p]))).map(x => ' - ' + x)];
  for (const p of R) {
    const h = p.hitch, gp = p.gpu;
    out.push('', `== ${p.name}${p.cut ? ' (CUT SHORT)' : ''} · ${p.secs} s · ${p.frames} frames (${p.fps} fps, display ~${Math.round(p.refresh)} Hz)`, ` frame ms  ${row(p.iv)}`,
      ` cpu ms    ${row(p.cpu)}`, `   stages avg: physics ${p.parts.phys} · visuals ${p.parts.vis} · audio ${p.parts.aud} · hud ${p.parts.hud} · cull ${p.parts.cull} · draw ${p.parts.draw}`,
      gp ? ` gpu ms    render ${row(gp.render)}${gp.compute ? `\n           compute ${row(gp.compute)}` : ''}  (${gp.samples} samples)` : ' gpu ms    n/a',
      ` load      ${p.draws} draws · ${p.tris}k tris`,
      ` hitches   ${h.n} over 1.5x median (${r1(h.n / Math.max(.1, p.secs))}/s) · ${h.over33} over 33 ms · ${h.over50} over 50 ms`);
    if (h.n) out.push(`   after: shadow refresh ${h.shadow} · dash upload ${h.dash} · gc ${h.gc} · env bake ${h.bake} · slow cpu ${h.cpu} · gpu/system ${h.other}`);
    for (const w of h.worst) out.push(`   worst: ${w.ms} ms after ${w.what} (cpu ${w.cpu}: phys ${w.phys} vis ${w.vis} draw ${w.draw})`);
    out.push(` events    shadow refresh ${p.flagged.shadow}${p.flagged.shadow && p.metres ? ` (every ${r1(p.metres / p.flagged.shadow)} m)` : ''} · dash upload ${p.flagged.dash} · gc ${p.flagged.gc} · env bake ${p.flagged.bake}`);
  }
  return out.join('\n');
}

/* ---------- start / end ---------- */
export function benchStart() { // called once the game is running (PLAY after the benchmark reload)
  if (ST || !CB.sync) return; try { sessionStorage.removeItem('cpmBench'); } catch (e) { }
  setTimeout(() => {
    TS = !!(renderer.backend && renderer.backend.trackTimestamp);
    ST = { i: 0, res: [], routes: {}, tod0: cfg.tod, tough0: cfg.tough, cam0: ctx.camMode, el: 0, dist: 0, t0: 0, rec: false };
    cfg.tod = 12; cfg.tough = true; BN.on = true; document.body.classList.add('benching'); $('bench').hidden = false;
    CB.reset(); if (!S.running) CB.startEngine(); lastT = 0; lastHeap = 0; lastBake = PC.bake; enter(0);
    document.addEventListener('visibilitychange', away);
  }, 1500); // let the first frames and the audio settle
}
function away() { if (document.hidden) end(false, 'The app went to the background'); }
$('benchX').onclick = () => end(false);
function end(ok, why) {
  if (!ST) return; const R = ST.res, D = device();
  document.removeEventListener('visibilitychange', away); BX.noShadow = false; sun.userData.shDirty = true; BX.post = true; if (renderer._rs !== 1) { renderer._rs = 1; setDPR(); }
  cfg.tod = ST.tod0; cfg.tough = ST.tough0; if (ctx.camMode !== ST.cam0) CB.toggleCam(); ST = null; BN.on = false; document.body.classList.remove('benching'); $('bench').hidden = true; CB.reset();
  if (ok) { try { localStorage.setItem('cpmBench', JSON.stringify({ v: 1, build: BUILD, at: Date.now(), text: report(R, D), data: { device: D, phases: R } })); } catch (e) { console.warn('bench: could not save', e); } }
  else CB.say(why ? 'Benchmark stopped: ' + why : 'Benchmark cancelled', 3000);
  CB.done(ok);
}
