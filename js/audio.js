// WebAudio. Engine = AudioWorklet voice (engine-worklet.js) with an oscillator fallback; speed-driven wind and
// tyre layers; crash/wall scrape; one-shots (starter, gear clunk, thud); island ambience from ctx.zones(x, z).
// Buses: eng / road / sfx → master; amb → ambLP → master; master → mLP → limiter → out.
import { cfg, BUILD } from './config.js';
import { S, ctx } from './state.js';
import { clamp, sstep, vnoise } from './util.js';

let AC = null, E = null, lastSpec = null, ambT = 0, crashWas = false, airWas = false, offR = 0, lastT = 0;
const A = {}, Z = { coast: 0, river: 0, town: 0, paddy: 0, volc: 0, wild: 0, sx: 0, sz: 0, rx: 0, rz: 0 };
const EXH = { gain: [1, 1.35, 1.7], bright: [1, 1.3, 1.6], pq: [1, 1.3, 1.6], crackle: [1, 2.4, 4], drive: [1, 1.15, 1.3], pipe: [1, .92, .85] };

// smoothed param set that skips near-identical values (saves automation events every frame)
function st(p, v, tc) { if (p._v !== undefined && Math.abs(p._v - v) < 1e-4) return; p._v = v; p.setTargetAtTime(v, AC.currentTime, tc); }
const node = (type, f, q, g) => { const n = type === 'gain' ? AC.createGain() : AC.createBiquadFilter(); if (type === 'gain') n.gain.value = g ?? 0; else { n.type = type; n.frequency.value = f; if (q) n.Q.value = q; } return n; };
const chain = (...n) => { for (let i = 1; i < n.length; i++) n[i - 1].connect(n[i]); return n[n.length - 1]; };
function noiseBuf(brown) {
  const b = AC.createBuffer(1, AC.sampleRate * 3, AC.sampleRate), d = b.getChannelData(0); let l = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { l = (l + .02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; }
  return b;
}
function loop(buf) { const s = AC.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2.5); return s; }
const pan = v => { if (!AC.createStereoPanner) return node('gain', 0, 0, 1); const p = AC.createStereoPanner(); p.pan.value = v; return p; };

export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { } // iOS: play with the silent switch on
  try { AC = window.__cpmAC || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch (e) { return; } // menu.js makes it inside the PLAY tap
  if (AC.state === 'suspended') AC.resume();
  document.addEventListener('visibilitychange', () => { if (!AC) return; document.hidden ? AC.suspend() : AC.resume(); });
  // master: volume → crash muffle → gentle limiter so engine + wind + ambience never clip phone speakers
  A.master = node('gain', 0, 0, cfg.vol ?? .8); A.mLP = node('lowpass', 20000, .5);
  const lim = AC.createDynamicsCompressor(); lim.threshold.value = -6; lim.knee.value = 8; lim.ratio.value = 8; lim.attack.value = .004; lim.release.value = .15;
  chain(A.master, A.mLP, lim, AC.destination);
  A.wn = noiseBuf(false); A.br = noiseBuf(true); const w1 = loop(A.wn), w2 = loop(A.wn), b1 = loop(A.br), b2 = loop(A.br);
  A.eng = node('gain', 0, 0, 0); A.eng.connect(A.master);
  A.sfx = node('gain', 0, 0, 1); A.sfx.connect(A.master);
  // ---- road layers ----
  A.road = node('gain', 0, 0, 1); A.road.connect(A.master);
  A.wPan = pan(0); A.wPan.connect(A.road);
  A.wLoF = node('lowpass', 200, .7); A.wLo = node('gain'); chain(b1, A.wLoF, A.wLo, A.wPan);          // wind rumble / buffeting
  A.wHiF = node('bandpass', 900, .7); A.wHi = node('gain'); chain(w1, A.wHiF, A.wHi, A.wPan);         // wind rush past the helmet
  A.tAF = node('lowpass', 300, .8); A.tA = node('gain'); chain(b2, A.tAF, A.tA, A.road);              // tyre roar on asphalt
  A.tDF = node('bandpass', 2200, .6); A.tD = node('gain'); chain(w2, A.tDF, A.tD, A.road);            // gravel/grass crunch
  A.skF = node('bandpass', 1150, 7); A.sk = node('gain'); chain(w1, A.skF, A.sk, A.road);             // tyre squeal
  A.scF = node('bandpass', 2800, 1.6); A.sc = node('gain'); chain(w2, A.scF, A.sc, A.road);           // metal/plastic scraping
  // CVT belt whine (Click); gain 0 for chain bikes
  // reduction-gear whine (Click): one sine per gear mesh, pitch = wheel rev/s × the bike's `sound.mesh` multipliers
  A.bwg = node('gain'); A.bwg.connect(A.eng); A.mesh = [0, 1].map(i => { const o = AC.createOscillator(), g = node('gain', 0, 0, i ? .5 : 1); chain(o, g, A.bwg); o.start(); return o; });
  // ---- ambience ----
  A.amb = node('gain', 0, 0, 0); A.ambLP = node('lowpass', 20000, .5); chain(A.amb, A.ambLP, A.master);
  A.surfP = pan(0); A.surfP.connect(A.amb); A.surf = node('gain'); chain(b1, node('lowpass', 650, .5), A.surf, A.surfP);
  A.rivP = pan(0); A.rivP.connect(A.amb); A.riv = node('gain'); chain(w2, node('bandpass', 1400, .5), node('peaking', 600, 1), A.riv, A.rivP);
  // cicadas: narrow high band, chopped ~45 Hz by an oscillator on the gain
  A.cic = node('gain'); const cAM = node('gain', 0, 0, .5), cO = AC.createOscillator(), cD = node('gain', 0, 0, .5); cO.frequency.value = 46; cO.connect(cD); cD.connect(cAM.gain); cO.start();
  chain(w1, node('bandpass', 5200, 6), cAM, A.cic, A.amb);
  A.hum = node('gain'); chain(b2, node('lowpass', 260, .7), A.hum, A.amb);                             // town hum
  A.vol = node('gain'); chain(b1, node('lowpass', 90, .7), A.vol, A.amb);                              // volcano rumble
  A.rus = node('gain'); A.rusF = node('bandpass', 1800, .8); chain(w1, A.rusF, A.rus, A.amb);          // wind in leaves / palms
  A.crk = node('gain'); const kAM = node('gain', 0, 0, .5), kO = AC.createOscillator(), kD = node('gain', 0, 0, .5); kO.frequency.value = 5.2; kO.type = 'square'; kO.connect(kD); kD.connect(kAM.gain); kO.start();
  chain(w2, node('bandpass', 4300, 14), kAM, A.crk, A.amb);                                             // night crickets: pulsed narrow band
  A.trf = node('gain'); chain(b2, node('lowpass', 420, .7), A.trf, A.amb);                              // distant traffic wash in town
  // ---- engine voice ----
  const ok = () => { A.wk = true; };
  if (AC.audioWorklet) AC.audioWorklet.addModule(new URL('./engine-worklet.js?v=' + BUILD, import.meta.url).href).then(() => {
    E = new AudioWorkletNode(AC, 'cpm-engine', { numberOfInputs: 0, outputChannelCount: [1] }); E.connect(A.eng); lastSpec = null; ok();
  }).catch(e => { console.warn('engine worklet failed, using oscillators', e); legacy(); }); else legacy();
}

// fallback voice: harmonic oscillators at firing frequency through a resonant low-pass and a waveshaper
function legacy() {
  const N = 64, re = new Float32Array(N), im = new Float32Array(N); for (let n = 1; n < N; n++) { im[n] = (n % 2 ? 1 : .7) / Math.pow(n, .55); re[n] = n % 3 ? 0 : .3 / n; }
  const wave = AC.createPeriodicWave(re, im); A.o = AC.createOscillator(); A.o.setPeriodicWave(wave); A.o2 = AC.createOscillator(); A.o2.setPeriodicWave(wave);
  A.lp = node('lowpass', 800, 3); A.g2 = node('gain', 0, 0, .3);
  const sh = AC.createWaveShaper(), cv = new Float32Array(256); for (let i = 0; i < 256; i++) cv[i] = Math.tanh((i / 128 - 1) * 2.2); sh.curve = cv;
  A.lg = node('gain'); A.o.connect(A.lp); chain(A.o2, A.g2, A.lp); chain(A.lp, sh, A.lg, A.eng); A.o.start(); A.o2.start();
}

function engineCfg(sp) {
  const s = sp.sound, x = sp.snd || 0;
  E.port.postMessage({
    cyl: s.cyl || 1, body: s.body, bq: s.bq, punch: s.punch, rough: s.rough, mech: s.mech, intake: s.intake, crackRpm: s.crackRpm || sp.red * .55,
    pipe: s.pipe * EXH.pipe[x], pq: s.pq * EXH.pq[x], bright: s.bright * EXH.bright[x], crackle: Math.min(1, s.crackle * EXH.crackle[x]), drive: s.drive * EXH.drive[x],
  });
}

export function updAudio() {
  if (!AC) return; const sp = ctx.spec; if (!sp) return; const sd = sp.sound, t = AC.currentTime, on = cfg.sound, x = sp.snd || 0;
  st(A.master.gain, on ? (cfg.vol ?? .8) : 0, .05);
  const fp = ctx.camMode === 0 && !ctx.GAR, live = !ctx.paused && !ctx.OPT && !ctx.GAR, v = Math.abs(S.v) || 0;
  // ---- engine ----
  if (CR && (!S.cranking || ctx.paused)) crank(false);
  const run = S.running, cut = S.lim || S.cutT > 0, dt = Math.min(.1, t - lastT); lastT = t;
  offR = run ? (S.rpm || 0) : Math.max(0, offR - dt * 3500); // switched off: the crank spins down, S.rpm may sit at idle
  st(A.eng.gain, (fp ? 1 : .85) * sd.gain * EXH.gain[x] * 1.35, .05);
  if (E) {
    if (sp !== lastSpec) { lastSpec = sp; engineCfg(sp); }
    const P = E.parameters; P.get('rpm').value = offR; P.get('load').value = S.thrEff || 0; P.get('on').value = run ? 1 : 0; P.get('cut').value = cut ? 1 : 0; P.get('vol').value = 1;
  } else if (A.o) {
    const f = Math.max(1, offR / 120); st(A.o.frequency, f, .015); st(A.o2.frequency, f / 2, .015);
    st(A.lp.frequency, (250 + S.rpm * .11 + S.thrEff * 1200) * [1, 1.35, 1.8][x] * sd.lp, .03); st(A.lp.Q, [3, 5, 8][x], .1);
    st(A.lg.gain, run ? (.1 + .35 * S.thrEff + .05 * S.rpm / 1e4) * 1.6 : 0, .03);
    if (run && x && S.thr < .05 && S.rpm > 5500 && Math.random() < .06 * x) blip('pop');
  }
  const wHz = v / (2 * Math.PI * sp.r), mm = sd.mesh || []; A.mesh.forEach((o, i) => st(o.frequency, Math.max(20, wHz * (mm[i] || 0)), .05));
  st(A.bwg.gain, sd.whine && mm.length ? sd.whine * .8 * Math.min(1, v / 15) * (.4 + .6 * (S.thrEff || 0)) * (S.c || 0) : 0, .1); // faint belt whir under drive, not a tone over the engine
  // ---- wind: rumble grows with v², the rush brightens with speed and gusts; louder with the head out in 1st person ----
  const gust = .8 + .4 * vnoise(t * .6, 3.1), wk = live ? (fp ? 1 : .3) * (1 - .35 * (S.thrEff || 0)) : 0, ws = Math.min(1, v * v / 1600); // engine stays on top: wind backs off on throttle
  st(A.wLo.gain, wk * ws * .25 * gust, .08); st(A.wLoF.frequency, 120 + v * 9, .1);
  st(A.wHi.gain, wk * ws * .07 * (.5 + .5 * gust), .08); st(A.wHiF.frequency, 500 + v * 55 * (.8 + .4 * gust), .1);
  if (A.wPan.pan) st(A.wPan.pan, clamp(-(S.lean || 0) * .9, -.4, .4), .1);
  // ---- tyres: asphalt roar vs dirt crunch; squeal past the grip limit; scraping on walls and in crashes ----
  const grounded = live && !S.air && !S.crashed, nr = ctx.nearRoad ? ctx.nearRoad(S.x, S.z) : null, onRd = Math.max(nr ? clamp(1.3 - nr.d / (nr.w / 2 + .5), 0, 1) : 0, sstep(.85, 1, Z.town)); // town and lot are paved
  const roll = grounded ? Math.min(1, v / 20) : 0, grit = .6 + .8 * vnoise(t * 9, 1.7);
  st(A.tA.gain, roll * (.08 + .15 * onRd) * (fp ? 1 : .7), .05); st(A.tAF.frequency, 140 + v * 9, .1);
  const slip = grounded ? Math.max(sstep(.95, 1.4, S.over || 0) * Math.min(1, v / 6), S.skid || 0) : 0;
  st(A.sk.gain, slip * .12 * onRd, .03); st(A.skF.frequency, 1050 + 160 * vnoise(t * 3, 5), .05); st(A.tD.gain, roll * (1 - onRd) * .16 * grit + slip * (1 - onRd) * .25, .03);
  const scr = live ? (S.crashed ? (S.v || 0) : (S.scrape || 0)) : 0;
  st(A.sc.gain, Math.min(.35, scr * .035) * grit, .03);
  // crash: muffle everything briefly (a knock to the helmet)
  if (S.crashed && !crashWas) { const f = A.mLP.frequency; f.cancelScheduledValues(t); f.setValueAtTime(700, t); f.setTargetAtTime(20000, t + .6, .5); A.mLP.frequency._v = undefined; }
  crashWas = !!S.crashed;
  if (airWas && !S.air && live && !S.crashed) blip('thud', 2); // touchdown: suspension thump
  airWas = !!S.air;
  // ---- ambience (10 Hz) ----
  if (t - ambT > .1) { ambT = t; ambience(t, v, live); }
}

function ambience(t, v, live) {
  const z = ctx.zones ? ctx.zones(S.x || 0, S.z || 0, Z) : null, on = cfg.amb !== false && cfg.sound;
  st(A.amb.gain, on && !ctx.paused ? (1 - .55 * sstep(3, 25, v)) * (1 - .2 * sstep(4000, 9000, S.rpm || 0)) : 0, .3);
  st(A.ambLP.frequency, ctx.GAR ? 700 : 20000, .2);
  if (!z) return;
  // ears: right vector of the bike's heading, for panning toward the sea and the river
  const rx = Math.cos(S.psi || 0), rz = -Math.sin(S.psi || 0), pdir = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return clamp((dx * rx + dz * rz) / l * .7, -.7, .7); };
  const swell = .55 + .45 * Math.pow(Math.sin(t * .85 + Math.sin(t * .31) * 2), 2);
  st(A.surf.gain, z.coast * .5 * swell, .25); if (A.surfP.pan) st(A.surfP.pan, pdir(z.sx, z.sz), .5);
  st(A.riv.gain, z.river * .22, .3); if (A.rivP.pan) st(A.rivP.pan, pdir(z.rx, z.rz), .5);
  const nt = ctx.night || 0, day = 1 - nt, cic = (z.wild + z.paddy * .6 * nt) * (.5 + .5 * Math.sin(t * .45) * Math.sin(t * .17 + 1)); // night: insects louder and in the paddies, town quieter
  const breeze = .5 + .5 * vnoise(t * .25, 8.3);
  st(A.rus.gain, (z.wild * .9 + z.paddy * .5 + z.coast * .2) * .07 * breeze * (1 - .4 * nt), .5); st(A.rusF.frequency, 1300 + 900 * breeze, .5);
  st(A.crk.gain, (z.wild * .6 + z.paddy) * nt * .035 * (.6 + .4 * Math.sin(t * .31)), .5); st(A.trf.gain, z.town * .06 * (1 - .5 * nt), .5);
  st(A.cic.gain, cic * .05 * (1 + .8 * nt), .4); st(A.hum.gain, z.town * .05 * (1 - .6 * nt), .4); st(A.vol.gain, z.volc * .35, .5);
  if (!on || ctx.paused) return;
  // one-shots, chance per 0.1 s tick
  const r = Math.random;
  if (r() < z.wild * .035 * day) bird();
  if (r() < (z.paddy * .9 + z.river * .4) * .05 * (1 + nt)) frog();
  if (r() < (z.town * .012 + z.wild * .002) * (1 - .4 * nt)) dog();
  if (r() < z.town * .01 * (1 - .8 * nt)) horn();
  if (r() < z.wild * .006 * nt) owl();
  if (r() < (z.wild * .4 + z.town * .5) * .012 * nt) gecko();
  if (r() < z.town * .006 * (1 - .5 * nt)) passby();
  if (r() < z.town * .0006 * (1 - .7 * nt)) bell();
  if (r() < z.coast * .004 * day) gull();
  if (r() < (z.paddy + z.town * .3) * .0015 * (day * .4 + 6 * (ctx.dawn || 0))) rooster(); // roosters mostly at dawn
}

// ---- ambience one-shots: synthesized, own gain + pan + distance low-pass, auto-disconnect ----
function shot(g, dur) {
  const t = AC.currentTime, near = Math.random(), out = node('gain', 0, 0, g * (.25 + .75 * near)), lp = node('lowpass', 1800 + 9000 * near, .5), p = pan((Math.random() * 2 - 1) * .85);
  chain(lp, out, p, A.amb); setTimeout(() => { p.disconnect(); }, (dur + .5) * 1000); return { t, inp: lp };
}
function osc(type, inp, t0, t1) { const o = AC.createOscillator(); o.type = type; o.connect(inp); o.start(t0); o.stop(t1); return o; }
function bird() {
  const n = 2 + Math.random() * 5 | 0, f = 2400 + Math.random() * 2200, sp = .08 + Math.random() * .1, { t, inp } = shot(.06, n * sp + .2);
  for (let i = 0; i < n; i++) {
    const a = t + i * sp, g = node('gain'); g.connect(inp); const o = osc('sine', g, a, a + .09);
    o.frequency.setValueAtTime(f * (1 + .15 * Math.random()), a); o.frequency.exponentialRampToValueAtTime(f * (.7 + .8 * Math.random()), a + .07);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(1, a + .008); g.gain.exponentialRampToValueAtTime(.001, a + .085);
  }
}
function frog() {
  const n = 1 + Math.random() * 3 | 0, f = 110 + Math.random() * 90, { t, inp } = shot(.09, n * .35 + .3), bp = node('bandpass', 650 + Math.random() * 300, 3); bp.connect(inp);
  for (let i = 0; i < n; i++) {
    const a = t + i * (.22 + Math.random() * .15), g = node('gain'); g.connect(bp); const o = osc('square', g, a, a + .16); o.frequency.setValueAtTime(f, a); o.frequency.linearRampToValueAtTime(f * .8, a + .15);
    g.gain.setValueAtTime(0, a); for (let k = 0; k < 4; k++) { g.gain.linearRampToValueAtTime(1, a + k * .035 + .01); g.gain.linearRampToValueAtTime(.05, a + k * .035 + .03); } g.gain.linearRampToValueAtTime(0, a + .15);
  }
}
function dog() {
  const n = 1 + Math.random() * 3 | 0, f = 380 + Math.random() * 200, { t, inp } = shot(.1, n * .35 + .3), bp = node('bandpass', 900, 1.4); bp.connect(inp);
  for (let i = 0; i < n; i++) {
    const a = t + i * (.25 + Math.random() * .12), g = node('gain'); g.connect(bp); const o = osc('sawtooth', g, a, a + .16);
    o.frequency.setValueAtTime(f, a); o.frequency.linearRampToValueAtTime(f * 1.3, a + .03); o.frequency.exponentialRampToValueAtTime(f * .6, a + .14);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(1, a + .012); g.gain.exponentialRampToValueAtTime(.001, a + .15);
  }
}
function horn() { // jeepney/tricycle horn: two detuned squares, sometimes a double honk
  const dbl = Math.random() < .5, len = .18 + Math.random() * .3, f = 340 + Math.random() * 120, { t, inp } = shot(.05, len * 2 + .4), lp = node('lowpass', 1600, 1); lp.connect(inp);
  for (let i = 0; i < (dbl ? 2 : 1); i++) {
    const a = t + i * (len + .1), g = node('gain'); g.connect(lp); osc('square', g, a, a + len).frequency.value = f; osc('square', g, a, a + len).frequency.value = f * 1.26;
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(.5, a + .02); g.gain.setValueAtTime(.5, a + len - .03); g.gain.linearRampToValueAtTime(0, a + len);
  }
}
function rooster() {
  const { t, inp } = shot(.07, 1.6), bp = node('bandpass', 1100, 1.2), g = node('gain'); chain(g, bp, inp); const o = osc('sawtooth', g, t, t + 1.3), f = o.frequency;
  f.setValueAtTime(520, t); f.linearRampToValueAtTime(760, t + .12); f.setValueAtTime(700, t + .2); f.linearRampToValueAtTime(900, t + .35); f.linearRampToValueAtTime(860, t + .9); f.exponentialRampToValueAtTime(520, t + 1.25);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.8, t + .03); g.gain.linearRampToValueAtTime(.3, t + .17); g.gain.linearRampToValueAtTime(.9, t + .3); g.gain.linearRampToValueAtTime(.7, t + 1); g.gain.linearRampToValueAtTime(0, t + 1.28);
}

function owl() { // two low hoots
  const { t, inp } = shot(.07, 1.4), lp = node('lowpass', 700, 1); lp.connect(inp);
  [0, .55].forEach((d, i) => { const a = t + d, g = node('gain'); g.connect(lp); const o = osc('sine', g, a, a + .4); o.frequency.setValueAtTime(380, a); o.frequency.linearRampToValueAtTime(330 - i * 30, a + .35);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(.9, a + .08); g.gain.linearRampToValueAtTime(0, a + .38); });
}
function gecko() { // tuko/tokay: a run of clicks that slows down
  const n = 4 + Math.random() * 5 | 0, { t, inp } = shot(.08, n * .4 + .4), bp = node('bandpass', 1500, 2); bp.connect(inp); let a = t;
  for (let i = 0; i < n; i++) { const g = node('gain'); g.connect(bp); const o = osc('square', g, a, a + .12); o.frequency.setValueAtTime(520 - i * 25, a); o.frequency.exponentialRampToValueAtTime(260, a + .1);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(1, a + .01); g.gain.exponentialRampToValueAtTime(.001, a + .11); a += .12 + i * .045; }
}
function gull() { // sea bird cry
  const { t, inp } = shot(.05, 1), g = node('gain'); g.connect(inp); const o = osc('sawtooth', g, t, t + .55), f = o.frequency;
  f.setValueAtTime(1500, t); f.linearRampToValueAtTime(2300, t + .15); f.linearRampToValueAtTime(1300, t + .5);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.8, t + .05); g.gain.linearRampToValueAtTime(0, t + .55);
}
function bell() { // church bell: inharmonic partials with long decay
  const { t, inp } = shot(.08, 5), f = 520 + Math.random() * 80;
  for (let k = 0; k < 3; k++) [1, 2.01, 2.76, 4.1].forEach((m, i) => { const a = t + k * 1.1, g = node('gain'); g.connect(inp); osc('sine', g, a, a + 3).frequency.value = f * m;
    g.gain.setValueAtTime(.5 / (i + 1), a); g.gain.exponentialRampToValueAtTime(.0005, a + 2.8); });
}
function passby() { // another vehicle passing in the distance: engine drone with a doppler glide and pan sweep
  const { t, inp } = shot(.06, 4), g = node('gain'), lp = node('lowpass', 900, 1), p = pan(-.8), o = osc('sawtooth', lp, t, t + 3.2), f = 55 + Math.random() * 40, dir = Math.random() < .5 ? -1 : 1;
  chain(lp, g, p, inp); o.frequency.setValueAtTime(f * 1.06, t); o.frequency.linearRampToValueAtTime(f * .94, t + 3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 1.5); g.gain.linearRampToValueAtTime(0, t + 3.2);
  if (p.pan) { p.pan.setValueAtTime(-.8 * dir, t); p.pan.linearRampToValueAtTime(.8 * dir, t + 3); }
}

// ---- game one-shots ----
// starter motor: whirr with compression chugs at the crank's firing rate; held while S.cranking (ignition.js calls crank(true) each step)
let CR = null;
export function crank(on) {
  if (!AC || !cfg.sound) return;
  if (on && !CR) {
    const t = AC.currentTime, k = ctx.spec?.sound?.starter ?? 1, cyl = Math.max(1, ctx.spec?.sound?.cyl || 1);
    const out = AC.createGain(), am = AC.createGain(), lp = AC.createBiquadFilter(), lg = AC.createGain(), o1 = AC.createOscillator(), o2 = AC.createOscillator(), lfo = AC.createOscillator();
    lp.type = 'lowpass'; lp.frequency.value = 1000; lp.Q.value = 2; o1.type = 'sawtooth'; o2.type = 'square';
    o1.frequency.setValueAtTime(60, t); o1.frequency.linearRampToValueAtTime(95, t + .4); o2.frequency.setValueAtTime(20, t); o2.frequency.linearRampToValueAtTime(31, t + .4);
    lfo.frequency.value = 230 / 120 * cyl; lg.gain.value = .5; am.gain.value = .6; lfo.connect(lg); lg.connect(am.gain);
    o1.connect(lp); o2.connect(lp); lp.connect(am); am.connect(out); out.connect(A.sfx);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(.14 * k, t + .08);
    o1.start(t); o2.start(t); lfo.start(t); CR = { out, n: [o1, o2, lfo] };
  } else if (!on && CR) {
    const c = CR, t = AC.currentTime; CR = null; c.out.gain.cancelScheduledValues(t); c.out.gain.setValueAtTime(c.out.gain.value, t); c.out.gain.linearRampToValueAtTime(0, t + .06); c.n.forEach(n => n.stop(t + .08));
  }
}
export function blip(type, amt = 1) {
  if (!AC || !cfg.sound) return; const t = AC.currentTime, g = node('gain'); g.connect(A.sfx);
  if (type === 'start') { // starter motor whirr, then the engine voice catches
    const k = ctx.spec?.sound?.starter ?? 1, lp = node('lowpass', 900, 2); chain(lp, g); const o = osc('sawtooth', lp, t, t + .6), o2 = osc('square', lp, t, t + .6);
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(150, t + .5); o2.frequency.setValueAtTime(23, t); o2.frequency.linearRampToValueAtTime(38, t + .5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12 * k, t + .04); g.gain.linearRampToValueAtTime(0, t + .58); return;
  }
  if (type === 'pump') { // fuel pump priming when the key goes on
    const o = osc('sine', g, t, t + 1.9); o.frequency.setValueAtTime(190, t); o.frequency.linearRampToValueAtTime(230, t + .5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.03, t + .1); g.gain.setValueAtTime(.03, t + 1.7); g.gain.linearRampToValueAtTime(0, t + 1.9); return;
  }
  if (type === 'ok') { [660, 880, 1320].forEach((fr, i) => { const gg = node('gain'); gg.connect(A.sfx); osc('sine', gg, t + i * .1, t + i * .1 + .25).frequency.value = fr; gg.gain.setValueAtTime(.12, t + i * .1); gg.gain.exponentialRampToValueAtTime(.001, t + i * .1 + .2); }); return; }
  if (type === 'click') { // gear change: low clunk through the frame + a short metallic tick
    const o = osc('sine', g, t, t + .1); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + .08); g.gain.setValueAtTime(.35, t); g.gain.exponentialRampToValueAtTime(.001, t + .09);
    const s = AC.createBufferSource(), bp = node('bandpass', 3200, 2), gg = node('gain'); s.buffer = A.wn; chain(s, bp, gg, A.sfx); gg.gain.setValueAtTime(.18, t); gg.gain.exponentialRampToValueAtTime(.001, t + .02); s.start(t, Math.random()); s.stop(t + .03); return;
  }
  const s = AC.createBufferSource(), fl = AC.createBiquadFilter(); s.buffer = A.wn;
  if (type === 'pop') { fl.type = 'bandpass'; fl.frequency.value = 600 + Math.random() * 900; g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); s.connect(fl); fl.connect(g); s.start(t, Math.random()); s.stop(t + .06); return; }
  // thud: low noise hit plus a falling sine for body
  const k = Math.min(1, .2 + amt * .08); fl.type = 'lowpass'; fl.frequency.value = 350;
  g.gain.setValueAtTime(k, t); g.gain.exponentialRampToValueAtTime(.001, t + .3); s.connect(fl); fl.connect(g); s.start(t, Math.random()); s.stop(t + .3);
  const gg = node('gain'); gg.connect(A.sfx); const o = osc('sine', gg, t, t + .25); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + .2); gg.gain.setValueAtTime(k * .8, t); gg.gain.exponentialRampToValueAtTime(.001, t + .22);
}
