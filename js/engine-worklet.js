// AudioWorklet engine voice (runs on the audio thread), a source-filter model of the real exhaust. Four-stroke: one
// blowdown pulse per cylinder every two revolutions, lasting a fixed crank angle (so it shortens as the revs rise).
// The pulse runs down the header, a quarter-wave pipe (valve end closed, muffler end open) done as a delay-line
// waveguide: round trip 2L/c, inverting reflection, so it rings at odd multiples of c/4L. c = sqrt(gamma R T) follows
// the gas temperature (load, revs, compression), so the pipe note rises as it heats. The muffler is a Helmholtz
// resonator (lowpass at f = c/2pi sqrt(A/VL)) with some straight-through leak; an open pipe has none. Geometry comes
// from the bike's real bore / stroke / rpm (acoustics() in spec.js). Valvetrain tick (scaled by mean piston speed), combustion knock
// (by compression ratio), intake runner resonance, roar and afterfire pops sit on top.
// Idle is not a steady drone: each cycle's strength and length vary, the idle speed hunts slowly, and a lumpy
// cam (c.lope) leaves some cycles diluted and the next one fat. c.fly = flywheel inertia vs stock (light = choppier).
// Main thread sets k-rate params every frame; the bike's character (and the garage tune) arrives via port.postMessage.
const TAU = Math.PI * 2;
class Res { // two-pole resonator, peak gain ~1
  constructor() { this.y1 = this.y2 = this.a1 = this.a2 = this.g = 0; }
  set(f, q, sr) { const r = Math.exp(-Math.PI * f / q / sr); this.a1 = 2 * r * Math.cos(TAU * f / sr); this.a2 = -r * r; this.g = 1 - r; }
  run(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
// soft clip: Pade tanh, within 2.5% of Math.tanh and a few times cheaper per sample
const sat = x => x <= -3 ? -1 : x >= 3 ? 1 : x * (27 + x * x) / (27 + 9 * x * x);
const dec = s => Math.exp(-1 / (sampleRate * s)); // per-sample decay for a time constant in seconds
const BUF = 2048, M = BUF - 1; // header delay line (2 x 1 m at 400 m/s is 240 samples at 48 kHz)
class Engine extends AudioWorkletProcessor {
  static get parameterDescriptors() { return ['rpm', 'load', 'on', 'cut', 'vol'].map(name => ({ name, defaultValue: 0, automationRate: 'k-rate' })); }
  constructor() {
    super();
    this.c = { cyl: 1, lh: .5, kH: .15, muf: 1, fin: 300, peak: 8000, cr: 10, upk: .11, evo: 0, pq: 5, bq: 2.5, punch: 1, rough: .1, crackle: .2, crackRpm: 6000, mech: .5, intake: .5, bright: 1, drive: 1.6, idle: 1400, lope: 0, fly: 1 };
    this.port.onmessage = e => Object.assign(this.c, e.data);
    this.ph = 0; this.half = 0; this.r = 0; this.ld = 0; this.ex = 0; this.nb = 0; this.tk = 0; this.pop = 0; this.ink = 0; this.jt = 1; this.carry = 0; this.hu = 0; this.idl = 0; this.kn = 0;
    this.cy = 0; this.cv = [1, 1, 1, 1, 1, 1, 1, 1]; this.cvT = 0; this.sub = 0; this.lp = 0; this.hx = 0; this.hy = 0; this.tx = 0; this.s = 0x9e3779b9;
    this.rasp = new Res(); this.intk = new Res(); this.F = [this.rasp, this.intk];
    this.buf = new Float32Array(BUF); this.wi = 0; this.wl = 0; this.mlp = 0; this.mbp = 0; this.q1 = 0; // header waveguide, muffler state
    // fixed time constants: crank-speed smoothing, valve tick, afterfire pop; header wall loss (one-pole in the loop)
    this.kR = 1 - dec(.012); this.dTk = dec(.00035); this.dPop = dec(.018); this.al = 1 - Math.exp(-TAU * 4000 / sampleRate);
  }
  rnd() { let s = this.s; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.s = s >>> 0; return this.s / 2147483648 - 1; }
  fire(on, cut) {
    const c = this.c, ld = this.ld, idl = this.idl; this.half = 0; this.jt = 1; if (this.r < 60) return;
    let a;
    if (on && !cut) {
      a = (.3 + .7 * ld) * (1 + c.rough * this.rnd() * (1.5 - ld)); // idle and part throttle lump more than WOT
      if (idl > 0) {
        // cam overlap at idle: some cycles misfire half-burnt, the leftover charge makes the next one bang harder
        const lp = c.lope * idl;
        if (lp > 0 && this.rnd() < lp * .4 - 1) { a *= .3; this.carry = .55; } else { a *= 1 + this.carry; this.carry = 0; }
        // and no two idle cycles take quite as long: rough engines, lumpy cams and light flywheels wander the most
        this.jt = 1 + (c.rough * .5 + lp * .16) * idl * this.rnd() / c.fly;
      }
      if (ld < .08 && this.r > c.crackRpm && this.rnd() < c.crackle * .24 - 1) { this.pop = .7 + .35 * (this.rnd() + 1); a *= .3; } // closed-throttle afterfire
    } else if (on) { a = .04; if (this.rnd() < c.crackle * .6 - 1) this.pop = .9 + .2 * (this.rnd() + 1); } // ignition cut: unburnt mix bangs in the pipe
    else a = .07; // switched off, still turning: compression only
    // each cylinder fires a little differently (fixed per-cylinder bias, slowly drifting), so multis aren't a perfect drone
    const cn = Math.max(1, c.cyl | 0), k = this.cy++ % cn; if (!this.cvT) { for (let i = 0; i < 8; i++) this.cv[i] = 1 + .16 * this.rnd(); this.cvT = 1; }
    a *= this.cv[k] * (1 + .04 * this.rnd());
    this.tk = Math.max(this.tk, this.kn * a); // combustion knock through the block, harder with compression
    this.ex = a * c.punch; this.sub = a * (.4 + .6 * ld); this.nb = a * (.15 + .85 * ld + .35 * c.lope * idl); this.ink = .15 + .85 * ld;
  }
  process(_, outs, P) {
    const o = outs[0] && outs[0][0]; if (!o) return true;
    const c = this.c, sr = sampleRate, n = o.length, on = P.on[0] > .5, cut = P.cut[0] > .5, vol = P.vol[0];
    let rpmT = P.rpm[0];
    // engine off and the crank has stopped (or sound off): nothing to synthesize. Settle once, then just output silence instead of
    // running the resonators on zeros for every block while the bike sits parked
    if (!on && rpmT < 1 && this.r < 20 || vol <= 0) {
      if (!this.rest && vol > 0) { this.rest = 1; this.r = this.ex = this.nb = this.pop = this.tk = this.sub = this.lp = this.hx = this.hy = this.tx = this.wl = this.mlp = this.mbp = this.q1 = 0; this.buf.fill(0); for (const f of this.F) f.y1 = f.y2 = 0; }
      if (vol <= 0) this.r = rpmT; // muted: keep the crank speed current so unmuting doesn't rev up from zero
      for (let ch = 0; ch < outs[0].length; ch++) outs[0][ch].fill(0);
      return true;
    }
    this.rest = 0;
    this.ld += (P.load[0] - this.ld) * .25;
    const ld = this.ld, r0 = this.r;
    // how "at idle" we are: near idle speed, throttle closed, firing. Drives the idle irregularity in fire() and the slow hunt here
    this.idl = on && !cut ? Math.max(0, Math.min(1, 1.8 - 1.2 * r0 / c.idle)) * Math.max(0, 1 - 3 * ld) : 0;
    this.hu += TAU * (.7 + .5 * c.lope) * n / sr; if (this.hu > TAU) this.hu -= TAU;
    rpmT *= 1 + this.idl * (.008 + .04 * c.lope) * Math.sin(this.hu) / c.fly;
    // header gas: ~600 K at idle to ~1100 K flat out; higher compression burns more of the heat, so runs cooler. c = sqrt(1.35 * 287 * T)
    const T = (600 + 300 * ld + 200 * Math.min(1.3, r0 / c.peak)) * Math.pow(10 / c.cr, .3), cs = 19.7 * Math.sqrt(T);
    const D = Math.min(BUF - 2, 2 * c.lh / cs * sr), gp = -Math.min(.9, Math.exp(-1.6 / c.pq)), gi = Math.sqrt(1 + gp); // round trip, reflection, input
    const fh = 2 * Math.sin(Math.PI * Math.min(sr / 8, 19.7 * Math.sqrt(.75 * T) * c.kH) / sr), qh = 1 / c.bq, km = c.muf * 8000, kp = (1 - .95 * c.muf) * 45; // muffler gas ~75% of header T
    // blowdown lasts ~60 crank degrees after the valve opens (more with a racing cam's earlier opening), the roar ~90 (seconds = deg / (6 rpm); decay constant a third of that)
    const rr = Math.max(300, r0), dEx = dec(Math.max(.00025, (60 + c.evo) / (18 * rr))), dNb = dec(Math.max(.0005, (90 + c.evo) / (18 * rr)));
    this.rasp.set(2300 + r0 * .15, 1.8, sr); this.intk.set(c.fin, 3, sr); this.kn = c.mech * .35 * Math.pow(c.cr / 10, 1.3);
    const kR = this.kR, dTk = this.dTk, dPop = this.dPop, buf = this.buf, al = this.al, dSub = Math.exp(-1 / (sr * Math.max(.003, .25 * 120 / Math.max(300, r0 * Math.max(1, c.cyl)))));
    // valve tick: audible at idle too (that's when you hear it most), grows with mean piston speed squared (c.upk = 2 * stroke / 60 / 17 m/s)
    const up = r0 * c.upk, fc = 1 - Math.exp(-TAU * Math.min(sr * .45, (700 + 3200 * ld + r0 * .3) * c.bright) / sr), mech = c.mech * (.35 + .65 * Math.min(1.6, up * up)), drive = c.drive, nd = Math.tanh(drive);
    const ri = c.intake, rg = (.4 + 1.6 * ld) * c.bright, sg = .8 + .6 * ld, dk = c.cyl / 120 / sr;
    for (let i = 0; i < n; i++) {
      this.r += (rpmT - this.r) * kR;
      this.ph += this.r * dk * this.jt;
      if (this.ph >= 1) { this.ph -= 1; this.fire(on, cut); }
      if (!this.half && this.ph >= .5) { this.half = 1; this.tk = mech; }
      const w = this.rnd(), ex = this.ex, exc = ex + this.nb * w * .6 + this.pop * w;
      this.ex *= dEx; this.nb *= dNb; this.pop *= dPop;
      // intake pulses land about three quarters of the way through the cycle
      const iw = this.ph > .6 && this.ph < .9 ? this.ink : this.ink * .2;
      // header: read the wave that went down and came back (fractional delay), lose a little to the walls, reflect inverted
      const rp = this.wi - D + BUF, i0 = rp | 0, fr = rp - i0, back = buf[i0 & M] + (buf[(i0 + 1) & M] - buf[i0 & M]) * fr;
      this.wl += (back - this.wl) * al; const pr = exc * gi + gp * this.wl; buf[this.wi] = pr; this.wi = (this.wi + 1) & M;
      // muffler: Helmholtz lowpass (state-variable filter) plus what leaks straight through
      this.mlp += fh * this.mbp; this.mbp += fh * (pr - this.mlp - qh * this.mbp);
      // tailpipe radiation: the can's outflow radiates as a pulsating source, p ~ dQ/dt (+6 dB/octave); the straight-through
      // part is already the pipe's own pressure wave at the outlet
      const q = this.mlp * km; let y = q - this.q1 + pr * kp + this.intk.run(w * iw) * ri; this.q1 = q;
      y += this.rasp.run(ex * (.5 + w * .5)) * rg;        // exhaust rasp under load
      if (this.sub > 1e-5) { this.sub *= dSub; const sp = TAU * this.ph; y += (Math.sin(sp) + .5 * Math.sin(2 * sp + .6)) * this.sub * sg; } // firing-rate fundamental, phase-locked to the stroke
      if (this.tk > 1e-5) { const tw = this.tk * w; y += (tw - this.tx) * .5; this.tx = tw; this.tk *= dTk; } else if (this.tx) { y -= this.tx * .5; this.tx = this.tk = 0; } // high-passed tick
      this.lp += (y - this.lp) * fc;
      y = sat(this.lp * .1 * drive) / nd;
      const hy = y - this.hx + .996 * this.hy; this.hx = y; this.hy = hy; // DC block (~30 Hz)
      o[i] = hy * vol;
    }
    for (let ch = 1; ch < outs[0].length; ch++) outs[0][ch].set(o);
    return true;
  }
}
registerProcessor('cpm-engine', Engine);
