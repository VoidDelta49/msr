// Drivetrains. Each one tells the physics the overall ratio (engine rad / wheel rad) and how much torque
// the clutch can carry right now; the shared clutch-slip solver in physics.js does the rest.
import { clamp, sstep, appr, PI } from './util.js';
import { say } from './hud.js';
import { blip } from './audio.js';

const kph = (s, R, rpm) => rpm * PI / 30 / R * s.r * 3.6;
const topV = s => Math.cbrt(s.peakPS * 735.5 * s.pow * s.eta / s.drag) * 3.6;

/* ---------- manual: return-shift gearbox + wet clutch on a lever ---------- */
const manual = {
  spec(s, bike, b) {
    const M = bike.manual;
    s.prim = M.prim; s.g = M.gears; s.nG = M.gears.length - 1; s.eta = M.eta; s.cap = M.clutchCap;
    s.final = b[M.final[0]] / b[M.final[1]];
  },
  reset(S) { S.gear = 0; },
  ratio(s, S) { return S.gear ? s.prim * s.g[S.gear] * s.final : 0; },
  // returns clutch torque capacity (Nm); S.c = engagement 0..1 for the UI
  clutch(s, S, b, av) {
    if (S.rpm > s.idle + 1800) S.ace = true; else if (S.rpm < s.idle + 250) S.ace = false;
    const lev = sstep(.15, .85, 1 - S.cl); S.lev = lev;
    let c = b.autoClutch ? Math.min(lev, S.ace ? 1 : .55 * sstep(s.idle + 300, s.idle + 2600, S.rpm)) : lev;
    if (b.autoClutch && (S.act > 0 || (S.brake > .5 && S.thr < .05 && av < 1.5))) c = 0;
    S.c = c; return c * s.cap;
  },
  update() { },
  pre() { },
  shift(s, S, d) {
    if (S.shCD > 0) return; if (S.cl < .6) { S.shCD = .3; say('Pull the clutch to shift', 900); blip('click'); return; }
    S.shCD = .15; let g = S.gear;
    if (d > 0) g = g === 0 ? 2 : g === 1 ? (Math.abs(S.v) < .6 ? 0 : 2) : Math.min(s.nG, g + 1); else g = g <= 2 ? 1 : g - 1;
    if (g !== S.gear) { S.gear = g; blip('click'); }
  },
  canStart(s, S, b) { if (S.gear && !b.autoClutch && S.cl < .7) return 'Pull the clutch or shift to N'; },
  stats(s, b) {
    const f = s.final, top = Math.min(kph(s, s.prim * s.g[s.nG] * f, s.red), topV(s));
    return `Final drive ${f.toFixed(2)} · redline ${s.red} rpm<br>1st tops out ${kph(s, s.prim * s.g[1] * f, s.red).toFixed(0)} km/h · ${s.nG}th gearing ${kph(s, s.prim * s.g[s.nG] * f, s.red).toFixed(0)} km/h<br>Est. top speed ≈ ${top.toFixed(0)} km/h`;
  },
};

/* ---------- CVT: V-belt variator (roller weights vs torque/center spring) + dry centrifugal clutch ---------- */
// The drive pulley's rollers push outward with ~m·ω²; the center spring and the torque cam push back, harder
// as the belt climbs (pos) and harder under load. The variator moves until those balance, so at a given
// throttle the engine settles at a "shift rpm" and the ratio does the rest.
const cvt = {
  spec(s, bike, b) {
    const C = bike.cvt, V = C.variator;
    s.final = C.final; s.eta = C.eta; s.lo ??= C.lo; s.hi ??= C.hi;
    s.e0 = C.clutch.e0 + s.eng; s.e1 = C.clutch.e1 + s.eng; s.cap = C.clutch.cap;
    s.vBase = V.base * Math.sqrt(V.roller / (s.roller ?? V.roller)); s.vPre = V.preload; s.vRise = V.rise; s.vLoad = V.load; s.vRate = V.rate;
  },
  reset(S) { S.gear = 0; S.pos = 0; S.issT = 0; S.issOff = false; },
  ratio(s, S) { return (s.lo + (s.hi - s.lo) * S.pos) * s.final; },
  eqRpm(s, pos, load) { return s.vBase * Math.sqrt(s.csp * (s.vPre + s.vRise * pos) + s.vLoad * load); },
  clutch(s, S) {
    // shoe force ~ ω² minus the spring preload: starts biting at e0, fully locked by e1
    const f = clamp((S.rpm * S.rpm - s.e0 * s.e0) / (s.e1 * s.e1 - s.e0 * s.e0), 0, 1);
    S.c = f; return f * s.cap;
  },
  update(s, S, dt, Tdrive, b) {
    const load = clamp(Tdrive / (s.tqMax * s.pow), 0, 1), eq = this.eqRpm(s, S.pos, load); S.rpmEq = eq;
    // the belt can only move while the rear pulley turns; when stopped the torque spring pulls it back to low
    if (S.v < .5) S.pos = appr(S.pos, 0, dt * 1.5);
    else S.pos = clamp(S.pos + clamp(s.vRate * (S.rpm - eq) / 1000, -2.5, 1.2) * dt, 0, 1);
  },
  // runs before the engine is integrated, so a restart's rpm isn't overwritten in the same step
  pre(s, S, dt, b) {
    // Idling Stop: engine off after 3 s stopped at idle, restarts on throttle
    if (b.iss && S.running && S.v < .1 && S.thr < .05 && S.rpm < s.idle + 400) { S.issT += dt; if (S.issT > 3) { S.running = false; S.issOff = true; } }
    else S.issT = 0;
    if (S.issOff && !S.running && S.thr > .05 && S.fuel > 0) { S.running = true; S.issOff = false; S.rpm = Math.max(S.rpm, s.idle + 200); }
    if (!b.iss && S.issOff) S.issOff = false;
  },
  shift() { },
  canStart(s, S) { if (S.brake < .3) return 'Hold the brake to start'; },
  stats(s) {
    const top = Math.min(kph(s, s.hi * s.final, s.red), topV(s));
    return `Ratio ${s.lo.toFixed(2)}–${s.hi.toFixed(2)} × final ${s.final.toFixed(1)} · redline ${s.red} rpm<br>Clutch bites ${s.e0} rpm, locks ${s.e1} rpm<br>Full-throttle shift rpm ≈ ${Math.round(this.eqRpm(s, 0, 1) / 50) * 50}–${Math.round(this.eqRpm(s, 1, 1) / 50) * 50}<br>Top ratio reaches ${kph(s, s.hi * s.final, s.red).toFixed(0)} km/h at redline · est. top speed ≈ ${top.toFixed(0)} km/h`;
  },
};

export const DRIVES = { manual, cvt };
