// AudioWorklet engine voice (runs on the audio thread). Four-stroke: one combustion pulse per cylinder every
// two revolutions. Each pulse excites a muffler-body resonator (the thump) and an exhaust-pipe resonator (the
// tone), plus a noise burst (roar); a valvetrain tick, intake hiss and afterfire pops sit on top.
// Main thread sets k-rate params every frame; the bike's character arrives once via port.postMessage.
const TAU = Math.PI * 2;
class Res { // two-pole resonator, peak gain ~1
  constructor() { this.y1 = this.y2 = this.a1 = this.a2 = this.g = 0; }
  set(f, q, sr) { const r = Math.exp(-Math.PI * f / q / sr); this.a1 = 2 * r * Math.cos(TAU * f / sr); this.a2 = -r * r; this.g = 1 - r; }
  run(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
class Engine extends AudioWorkletProcessor {
  static get parameterDescriptors() { return ['rpm', 'load', 'on', 'cut', 'vol'].map(name => ({ name, defaultValue: 0, automationRate: 'k-rate' })); }
  constructor() {
    super();
    this.c = { cyl: 1, pipe: 340, pq: 5, body: 100, bq: 2.5, punch: 1, rough: .1, crackle: .2, crackRpm: 6000, mech: .5, intake: .5, bright: 1, drive: 1.6 };
    this.port.onmessage = e => Object.assign(this.c, e.data);
    this.ph = 0; this.half = 0; this.r = 0; this.ld = 0; this.ex = 0; this.nb = 0; this.tk = 0; this.pop = 0; this.ink = 0;
    this.cy = 0; this.cv = [1, 1, 1, 1, 1, 1, 1, 1]; this.cvT = 0; this.sub = 0; this.lp = 0; this.hx = 0; this.hy = 0; this.tx = 0; this.s = 0x9e3779b9; this.body = new Res(); this.pipe = new Res(); this.pipe2 = new Res(); this.rasp = new Res(); this.intk = new Res();
  }
  rnd() { let s = this.s; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.s = s >>> 0; return this.s / 2147483648 - 1; }
  fire(on, cut) {
    const c = this.c, r = this.r, ld = this.ld; this.half = 0; if (r < 60) return;
    let a;
    if (on && !cut) {
      a = (.3 + .7 * ld) * (1 + c.rough * this.rnd() * (1.5 - ld)); // idle and part throttle lump more than WOT
      if (ld < .08 && r > c.crackRpm && Math.random() < c.crackle * .12) { this.pop = .7 + .7 * Math.random(); a *= .3; } // closed-throttle afterfire
    } else if (on) { a = .04; if (Math.random() < c.crackle * .3) this.pop = .9 + .4 * Math.random(); } // ignition cut: unburnt mix bangs in the pipe
    else a = .07; // switched off, still turning: compression only
    // each cylinder fires a little differently (fixed per-cylinder bias, slowly drifting), so multis aren't a perfect drone
    const cn = Math.max(1, c.cyl | 0), k = this.cy++ % cn; if (!this.cvT) { for (let i = 0; i < 8; i++) this.cv[i] = 1 + .16 * this.rnd(); this.cvT = 1; }
    a *= this.cv[k] * (1 + .04 * this.rnd());
    this.ex = a * c.punch; this.sub = a * (.4 + .6 * ld); this.nb = a * (.15 + .85 * ld); this.ink = .15 + .85 * ld;
  }
  process(_, outs, P) {
    const o = outs[0] && outs[0][0]; if (!o) return true;
    const c = this.c, sr = sampleRate, n = o.length, on = P.on[0] > .5, cut = P.cut[0] > .5, vol = P.vol[0], rpmT = P.rpm[0];
    // engine off and the crank has stopped (or sound off): nothing to synthesize. Settle once, then just output silence instead of
    // running the resonators on zeros for every block while the bike sits parked
    if (!on && rpmT < 1 && this.r < 20 || vol <= 0) {
      if (!this.rest && vol > 0) { this.rest = 1; this.r = this.ex = this.nb = this.pop = this.tk = this.sub = this.lp = this.hx = this.hy = this.tx = 0; for (const f of [this.body, this.pipe, this.pipe2, this.rasp, this.intk]) f.y1 = f.y2 = 0; }
      if (vol <= 0) this.r = rpmT; // muted: keep the crank speed current so unmuting doesn't rev up from zero
      for (let ch = 0; ch < outs[0].length; ch++) outs[0][ch].fill(0);
      return true;
    }
    this.rest = 0;
    this.ld += (P.load[0] - this.ld) * .25;
    const ld = this.ld, r0 = this.r;
    this.body.set(c.body * (1 + .2 * ld), c.bq, sr); this.pipe2.set(c.pipe * 2.35 * (1 + .06 * ld), c.pq * 1.6, sr); this.rasp.set(2300 + r0 * .15, 1.8, sr); this.pipe.set(c.pipe * (1 + .08 * ld + r0 / 60000), c.pq, sr); this.intk.set(250 + r0 * .07, 2.2, sr);
    const kR = 1 - Math.exp(-1 / (sr * .012)), dEx = Math.exp(-1 / (sr * .0008)), dNb = Math.exp(-1 / (sr * .005)), dTk = Math.exp(-1 / (sr * .00035)), dPop = Math.exp(-1 / (sr * .018)), dSub = Math.exp(-1 / (sr * Math.max(.003, .25 * 120 / Math.max(300, r0 * Math.max(1, c.cyl)))));
    const fc = 1 - Math.exp(-TAU * Math.min(sr * .45, (700 + 3200 * ld + r0 * .3) * c.bright) / sr), mech = c.mech * Math.min(1, r0 / 9000), drive = c.drive, nd = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      this.r += (rpmT - this.r) * kR;
      this.ph += this.r * c.cyl / 120 / sr;
      if (this.ph >= 1) { this.ph -= 1; this.fire(on, cut); }
      if (!this.half && this.ph >= .5) { this.half = 1; this.tk = mech; }
      const w = this.rnd(), exc = this.ex + this.nb * w * .6 + this.pop * w;
      this.ex *= dEx; this.nb *= dNb; this.pop *= dPop;
      // intake pulses land about three quarters of the way through the cycle
      const iw = this.ph > .6 && this.ph < .9 ? this.ink : this.ink * .25;
      let y = this.body.run(exc) * 2.2 + this.pipe.run(exc) * 1.6 + this.pipe2.run(exc) * .9 * c.bright + this.intk.run(w * iw) * c.intake * .5;
      y += this.rasp.run(this.ex * (.5 + w * .5)) * (.4 + 1.6 * ld) * c.bright;        // exhaust rasp under load
      this.sub *= dSub; const sp = TAU * this.ph; y += (Math.sin(sp) + .5 * Math.sin(2 * sp + .6)) * this.sub * (.8 + .6 * ld); // firing-rate fundamental, phase-locked to the stroke
      const tw = this.tk * w; y += (tw - this.tx) * .5; this.tx = tw; this.tk *= dTk; // high-passed tick
      this.lp += (y - this.lp) * fc;
      y = Math.tanh(this.lp * .1 * drive) / nd;
      const hy = y - this.hx + .996 * this.hy; this.hx = y; this.hy = hy; // DC block (~30 Hz)
      o[i] = hy * vol;
    }
    for (let ch = 1; ch < outs[0].length; ch++) outs[0][ch].set(o);
    return true;
  }
}
registerProcessor('cpm-engine', Engine);
