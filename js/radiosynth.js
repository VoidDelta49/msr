// In-game radio, the sound side: turns the note events from radiogen.js into WebAudio. Takes the AudioContext as an argument
// and imports nothing from the game, so tools/radio.mjs can render it offline in a real browser and measure it.
// Everything is synthesized (oscillators, periodic waves, filtered noise): no samples, no files.
const hz = m => 440 * 2 ** ((m - 69) / 12);
// level trim per station (measured with tools/radio.mjs so the four stations sit at the same loudness)
export const TRIM = [.6, .6, .58, .8];

export function noiseBuffer(AC) { const b = AC.createBuffer(1, AC.sampleRate, AC.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }

// One station's signal path: inp (all notes go here) -> tone shaping -> compressor -> out (the level knob) -> dst. `send` feeds the echo.
export function buildStation(AC, si, dst, noise) {
  const all = [], srcs = [], mk = n => (all.push(n), n);
  const gain = v => { const n = mk(AC.createGain()); n.gain.value = v; return n; };
  const bq = (type, f, q = .7, g = 0) => { const n = mk(AC.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = g; return n; };
  const out = gain(0); out.connect(dst);
  const comp = mk(AC.createDynamicsCompressor()); comp.threshold.value = -18; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .22;
  const trim = gain(TRIM[si]); comp.connect(trim); trim.connect(out); // trim after the compressor: it sees the same level whatever the trim
  const inp = gain(1);
  let head = inp; const to = n => { head.connect(n); head = n; };
  if (si === 0) to(bq('highpass', 70));
  else if (si === 1) to(bq('highpass', 45));
  else if (si === 2) { to(bq('lowpass', 4300, .6)); to(bq('highpass', 80)); }
  else { // an old AM radio: narrow band, a bump in the mids, a little clipping, hiss
    to(bq('highpass', 320)); to(bq('peaking', 1500, 1, 5)); to(bq('lowpass', 3300, .7));
    const sh = mk(AC.createWaveShaper()), c = new Float32Array(257); for (let i = 0; i < 257; i++) c[i] = Math.tanh((i / 128 - 1) * 2.2) / 2.2; // soft clipping with unity gain for small signals sh.curve = c; to(sh);
    const hs = AC.createBufferSource(); hs.buffer = noise; hs.loop = true; const hb = bq('bandpass', 2300, .6), hg = gain(.014); hs.connect(hb); hb.connect(hg); hg.connect(comp); hs.start(); srcs.push(hs);
  }
  head.connect(comp);
  const send = gain(1), dly = mk(AC.createDelay(2)), fb = gain(.36), flp = bq('lowpass', 2600, .5), wet = gain([.32, .45, .26, .12][si]);
  send.connect(dly); dly.connect(flp); flp.connect(fb); fb.connect(dly); flp.connect(wet); wet.connect(inp);
  return {
    si, inp, send, out, setTempo(stepDur) { dly.delayTime.value = Math.min(1.5, 3 * stepDur); }, // a dotted eighth
    stop() { for (const s of srcs) try { s.stop(); } catch (e) { } for (const n of all) try { n.disconnect(); } catch (e) { } },
  };
}

// The voices. play(ev, t, sd): ev from stepEvents(), t = start time, sd = seconds per step.
export function createPlayer(AC, st, noise) {
  const D = st.inp, SND = st.send, si = st.si;
  const W = k => AC.createPeriodicWave(new Float32Array(k.length), Float32Array.from(k)); // k[n] = amplitude of harmonic n (k[0] unused)
  const wave = { bell: W([0, 1, .45, .2, .08, .04]), soft: W([0, 1, .5, .25, .12]), rhodes: W([0, 1, .18, .05, 0, .03]), bass: W([0, 1, .35, .12, .06, .03]), organ: W([0, 1, .1, .55, .1, .3, 0, .12]) };
  const amp = (t, pk, a, d, to) => { const g = AC.createGain(); a = Math.max(a, .001); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(.0008, t + a + d); g.connect(to); return g; };
  const adsr = (t, pk, a, sus, dur, rel, to) => { const g = AC.createGain(), e = t + Math.max(dur, a + .03); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.setTargetAtTime(pk * sus, t + a, .08); g.gain.setTargetAtTime(0, e, rel / 3); g.connect(to); return { g, end: e + rel * 1.6 }; };
  const osc = (type, f, t0, t1, to, cents) => { const o = AC.createOscillator(); if (type.constructor === String) o.type = type; else o.setPeriodicWave(type); o.frequency.value = f; if (cents) o.detune.value = cents; o.connect(to); o.start(t0); o.stop(t1); return o; };
  const nz = (t0, dur, to) => { const s = AC.createBufferSource(); s.buffer = noise; s.connect(to); s.start(t0, Math.random() * .7); s.stop(t0 + dur); };
  const bp = (type, f, q, to) => { const n = AC.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(to); return n; };
  const echo = (from, k) => { const g = AC.createGain(); g.gain.value = k; from.connect(g); g.connect(SND); };

  const V = {
    kick(t, v) { const g = amp(t, [.8, .78, .95, .9][si] * v, .003, si === 3 ? .22 : .3, D), o = AC.createOscillator(); o.frequency.setValueAtTime(si === 3 ? 105 : 150, t); o.frequency.exponentialRampToValueAtTime(si === 3 ? 52 : 44, t + .12); o.connect(g); o.start(t); o.stop(t + .4); },
    snare(t, v) { nz(t, .25, bp('bandpass', [2200, 2400, 1500, 1800][si], .7, amp(t, [.40, .4, .3, .3][si] * v, .001, .15, D))); osc('triangle', 185, t, t + .15, amp(t, .26 * v, .001, .09, D)); },
    clap(t, v) { const g = AC.createGain(); g.connect(D); g.gain.setValueAtTime(0, t); for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(.56 * v, t + k * .011); g.gain.linearRampToValueAtTime(.05, t + k * .011 + .009); } g.gain.setValueAtTime(.56 * v, t + .033); g.gain.exponentialRampToValueAtTime(.0008, t + .24); nz(t, .27, bp('bandpass', 1500, 1.1, g)); },
    brush(t, v) { const g = AC.createGain(); g.connect(D); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.2 * v, t + .025); g.gain.exponentialRampToValueAtTime(.0008, t + .25); nz(t, .28, bp('highpass', 2500, .5, g)); },
    hat(t, v) { nz(t, .07, bp('highpass', 7500, .6, amp(t, .2 * v, .001, .045, D))); },
    ohat(t, v) { nz(t, .26, bp('highpass', 7000, .6, amp(t, .17 * v, .002, .2, D))); },
    bass(t, v, e, sd) { const f = hz(e.m), dur = Math.max(.12, e.d * sd * .95), lp = bp('lowpass', si === 1 ? 900 : 520, .7, adsr(t, [.2, .17, .2, .2][si] * v, .006, .85, dur, .06, D).g); osc(wave.bass, f, t, t + dur + .2, lp); },
    pad(t, v, e, sd) { const dur = e.d * sd, k = e.n.length, lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = [1400, 2400, 1400, 1100][si]; lp.Q.value = .3; const r = adsr(t, [.15, .15, .15, .15][si] * v / k, si === 3 ? .5 : .3, .85, dur, .6, D); lp.connect(r.g);
      for (const m of e.n) { osc('sawtooth', hz(m), t, r.end, lp, -7); osc('sawtooth', hz(m), t, r.end, lp, 7); } },
    rhodes(t, v, e) { const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(D); e.n.forEach((m, k) => { const a = t + k * .016; osc(wave.rhodes, hz(m), a, a + 2, amp(a, .2 * v / e.n.length * 2, .004, 1.7, lp)); }); },
    skank(t, v, e) { const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .8; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(1500, t + .1); lp.connect(amp(t, .4 * v, .002, .13, D)); for (const m of e.n) osc('sawtooth', hz(m), t, t + .2, lp); },
    organ(t, v, e, sd) { const r = adsr(t, .2 * v / e.n.length, .02, .9, e.d * sd * .9, .08, D); for (const m of e.n) osc(wave.organ, hz(m), t, r.end, r.g); },
    arp(t, v, e) { const f = hz(e.m), lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.setValueAtTime(3400, t); lp.frequency.exponentialRampToValueAtTime(900, t + .14); const g = amp(t, .17 * v, .002, .17, D); lp.connect(g); echo(g, .5); osc('sawtooth', f, t, t + .22, lp); osc('sawtooth', f, t, t + .22, lp, 9); },
    lead(t, v, e, sd) {
      const f = hz(e.m), dur = Math.max(.1, e.d * sd);
      if (si === 0) { const g = amp(t, .33 * v, .004, Math.max(.4, Math.min(1.3, dur)), D); echo(g, .45); osc(wave.bell, f, t, t + 1.8, g); }
      else if (si === 2) { const g = amp(t, .24 * v, .006, 1.1, D); echo(g, .25); osc(wave.rhodes, f, t, t + 1.6, g); }
      else { // takbo: detuned saws in a filter; am: a soft voice. Both get vibrato once the note has settled
        const takbo = si === 1, lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = takbo ? 2600 : 1700; lp.Q.value = .5;
        const r = adsr(t, (takbo ? .12 : .09) * v, takbo ? .015 : .06, takbo ? .8 : .85, dur, takbo ? .25 : .15, D); lp.connect(r.g); echo(r.g, takbo ? .6 : .12);
        const o1 = osc(takbo ? 'sawtooth' : wave.soft, f, t, r.end, lp, -6), o2 = osc(takbo ? 'sawtooth' : wave.soft, f, t, r.end, lp, 6);
        if (dur > .25) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = 5.4; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(takbo ? 8 : 12, t + .45); l.connect(lg); lg.connect(o1.detune); lg.connect(o2.detune); l.start(t); l.stop(r.end); }
      }
    },
  };
  return {
    play(ev, t, sd) { const f = V[ev.i]; if (f) f(t, ev.v, ev, sd); },
    // the station's ident between songs: three rising bell notes
    jingle(t) { [0, 4, 7].forEach((s, k) => { const a = t + k * .16; osc(wave.bell, hz(76 + s), a, a + 1.2, amp(a, .2, .004, .9, D)); }); },
    // vinyl crackle (lo-fi) / AM static (am): a tiny burst of noise now and then
    crackle(t, k) { nz(t, .02, bp(si === 3 ? 'bandpass' : 'highpass', si === 3 ? 1800 : 3000, si === 3 ? .8 : .5, amp(t, k, .001, si === 3 ? .02 : .006, D))); },
  };
}

// the sweep of static between two stations (and a short click when the radio goes off); dst = the level it should land on
export function tuneStatic(AC, dst, noise, t, level) {
  const f = AC.createBiquadFilter(), g = AC.createGain(), s = AC.createBufferSource(); f.type = 'bandpass'; f.Q.value = 2.2; f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(2800, t + .3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.45 * level, t + .03); g.gain.setTargetAtTime(0, t + .1, .07); s.buffer = noise; s.connect(f); f.connect(g); g.connect(dst); s.start(t, Math.random() * .6); s.stop(t + .45);
  const o = AC.createOscillator(), og = AC.createGain(); o.frequency.setValueAtTime(1100, t); o.frequency.exponentialRampToValueAtTime(520, t + .28); og.gain.setValueAtTime(.05 * level, t); og.gain.exponentialRampToValueAtTime(.0008, t + .3); o.connect(og); og.connect(dst); o.start(t); o.stop(t + .32);
}
