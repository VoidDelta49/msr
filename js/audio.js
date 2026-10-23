// WebAudio engine: harmonic oscillator at firing frequency, intake noise, wind, CVT belt whine, one-shot blips
import { cfg } from './config.js';
import { S, ctx } from './state.js';

let AC = null; const A = {};
export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  A.master = AC.createGain(); A.master.gain.value = .7; A.master.connect(AC.destination);
  const N = 64, re = new Float32Array(N), im = new Float32Array(N); for (let n = 1; n < N; n++) { im[n] = (n % 2 ? 1 : .7) / Math.pow(n, .55); re[n] = n % 3 ? 0 : .3 / n; }
  const wave = AC.createPeriodicWave(re, im); A.o = AC.createOscillator(); A.o.setPeriodicWave(wave); A.o2 = AC.createOscillator(); A.o2.setPeriodicWave(wave);
  A.lp = AC.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.Q.value = 3; A.g2 = AC.createGain(); A.g2.gain.value = .3;
  const sh = AC.createWaveShaper(), cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; cv[i] = Math.tanh(x * 2.2); } sh.curve = cv;
  A.g = AC.createGain(); A.g.gain.value = 0; A.o.connect(A.lp); A.o2.connect(A.g2); A.g2.connect(A.lp); A.lp.connect(sh); sh.connect(A.g); A.g.connect(A.master);
  A.nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const d = A.nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = () => { const s = AC.createBufferSource(); s.buffer = A.nb; s.loop = true; s.start(); return s; };
  A.bp = AC.createBiquadFilter(); A.bp.type = 'bandpass'; A.bp.Q.value = 1.2; A.ng = AC.createGain(); A.ng.gain.value = 0; ns().connect(A.bp); A.bp.connect(A.ng); A.ng.connect(A.master);
  A.wl = AC.createBiquadFilter(); A.wl.type = 'lowpass'; A.wl.frequency.value = 500; A.wg = AC.createGain(); A.wg.gain.value = 0; ns().connect(A.wl); A.wl.connect(A.wg); A.wg.connect(A.master);
  // belt whine (CVT only; gain 0 for chain bikes)
  A.bw = AC.createOscillator(); A.bw.type = 'triangle'; A.bwg = AC.createGain(); A.bwg.gain.value = 0; A.bw.connect(A.bwg); A.bwg.connect(A.master); A.bw.start();
  A.o.start(); A.o2.start();
}
export function updAudio() {
  if (!AC) return; const sp = ctx.spec, sd = sp.sound, t = AC.currentTime, on = cfg.sound, f = Math.max(1, S.rpm / 120), ex = sp.snd, run = S.running && on;
  A.o.frequency.setTargetAtTime(f, t, .015); A.o2.frequency.setTargetAtTime(f / 2, t, .015);
  A.lp.frequency.setTargetAtTime((250 + S.rpm * .11 + S.thrEff * 1200) * [1, 1.35, 1.8][ex] * sd.lp, t, .03); A.lp.Q.setTargetAtTime([3, 5, 8][ex], t, .1);
  A.g.gain.setTargetAtTime(run ? (.1 + .35 * S.thrEff + .05 * S.rpm / 1e4) * [1, 1.6, 2.2][ex] * sd.gain : 0, t, .03);
  if (run && ex && S.thr < .05 && S.rpm > 5500 && Math.random() < .06 * ex) blip('pop');
  A.bp.frequency.setTargetAtTime(600 + S.rpm * .25, t, .05); A.ng.gain.setTargetAtTime(run ? .015 + .05 * S.thrEff : 0, t, .05);
  A.wg.gain.setTargetAtTime(on ? Math.min(.25, S.v * S.v * .00025) : 0, t, .1);
  // whine pitch follows the driven pulley (wheel speed × final drive)
  const wv = Math.abs(S.v) / sp.r * (sp.final || 1);
  A.bw.frequency.setTargetAtTime(80 + wv * 2.2, t, .05);
  A.bwg.gain.setTargetAtTime(on && sd.whine ? sd.whine * Math.min(1, Math.abs(S.v) / 12) * (.3 + .7 * S.c) : 0, t, .08);
}
export function blip(type, amt = 1) {
  if (!AC || !cfg.sound) return; const t = AC.currentTime, g = AC.createGain(); g.connect(A.master);
  if (type === 'start') { const o = AC.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(25, t); o.frequency.linearRampToValueAtTime(60, t + .5); g.gain.setValueAtTime(.08, t); g.gain.linearRampToValueAtTime(0, t + .55); o.connect(g); o.start(t); o.stop(t + .6); return; }
  if (type === 'ok') { [660, 880, 1320].forEach((fr, i) => { const o = AC.createOscillator(), gg = AC.createGain(); o.frequency.value = fr; gg.gain.setValueAtTime(.12, t + i * .1); gg.gain.exponentialRampToValueAtTime(.001, t + i * .1 + .2); o.connect(gg); gg.connect(A.master); o.start(t + i * .1); o.stop(t + i * .1 + .25); }); return; }
  const s = AC.createBufferSource(), fl = AC.createBiquadFilter(); s.buffer = A.nb; const thud = type === 'thud';
  if (type === 'pop') { fl.type = 'bandpass'; fl.frequency.value = 600 + Math.random() * 900; g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); s.connect(fl); fl.connect(g); s.start(t, Math.random()); s.stop(t + .06); return; }
  fl.type = thud ? 'lowpass' : 'bandpass'; fl.frequency.value = thud ? 300 : 2200; const len = thud ? .3 : .04;
  g.gain.setValueAtTime(thud ? Math.min(1, .2 + amt * .08) : .25, t); g.gain.exponentialRampToValueAtTime(.001, t + len); s.connect(fl); fl.connect(g); s.start(t, Math.random()); s.stop(t + len);
}
