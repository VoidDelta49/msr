// Drivetrains. Each one tells the physics the overall ratio (engine rad / wheel rad) and how much torque
// the clutch can carry right now; the shared clutch-slip solver in physics.js does the rest.
import { clamp, sstep, appr, PI } from './util.js';
import { say } from './hud.js';
import { blip } from './audio.js';

const kph = (s, R, rpm) => rpm * PI / 30 / R * s.r * 3.6;
const topV = s => Math.cbrt(s.peakPS * 735.5 * s.pow * (s.tqc || 1) * s.eta / s.drag) * 3.6;

/* ---------- manual: return-shift gearbox + wet clutch on a lever ---------- */
const manual = {
  spec(s, bike, b) {
    const M = bike.manual;
    s.prim = M.prim; s.g = M.gears; s.nG = M.gears.length - 1; s.eta = M.eta; s.cap = M.clutchCap;
    // pattern (from the owner's manual): 'return' = 1 down, rest up (N between 1st and 2nd); 'down' = N on top, every gear below it
    // (Honda TMX Supremo "five-down"): each toe press goes up one gear, each heel press down one, and 1st -> N is an ordinary click
    s.pat = M.pattern || 'return';
    s.slipper = M.slipper || 0; s.eclutch = !!M.eclutch; s.qs = !!M.qs; // slipper: back-torque the clutch carries before it slips (Nm); eclutch: ECU works the clutch on shifts
    s.final = b[M.final[0]] / b[M.final[1]];
  },
  reset(S) { S.gear = 0; },
  ratio(s, S) { return S.gear ? s.prim * s.g[S.gear] * s.final : 0; },
  // returns clutch torque capacity (Nm); S.c = engagement 0..1 for the UI
  clutch(s, S, b, av) {
    const lev = sstep(.15, .85, 1 - S.cl); S.lev = lev; let c;
    if (s.eclutch) {
      // E-Clutch: the actuator slips the clutch on pull-away, harder with more throttle (full throttle holds ~6,000 rpm),
      // and locks it once the engine and the gearbox side have met; opens it again near idle, so it never stalls
      const rw = S.gear ? av / s.r * s.prim * s.g[S.gear] * s.final * 30 / PI : 0;
      if (rw > s.idle + 300 && Math.abs(S.rpm - rw) < 400) S.ace = true; else if (S.rpm < s.idle + 250) S.ace = false;
      c = b.autoClutch ? Math.min(lev, S.ace ? 1 : sstep(s.idle + 200, s.idle + 1200 + 8000 * S.thr, S.rpm)) : lev;
    } else {
      if (S.rpm > s.idle + 1800) S.ace = true; else if (S.rpm < s.idle + 250) S.ace = false;
      c = b.autoClutch ? Math.min(lev, S.ace ? 1 : .55 * sstep(s.idle + 300, s.idle + 2600, S.rpm)) : lev;
    }
    if ((S.act > 0 && (b.autoClutch || s.qs)) || (b.autoClutch && S.brake > .5 && S.thr < .05 && av < 1.5)) c = 0; // act: shift actuator / quickshifter dog window
    S.c = c; return c * s.cap;
  },
  update() { },
  pre() { },
  shift(s, S, d, b) {
    // Honda E-Clutch: with the lever out, the ECU's actuator opens the clutch for the shift. Upshifts also cut the
    // ignition so the engine is pulled down to the new gear's rpm; downshifts re-engage onto the slipper clutch.
    // Quickshifter (H2): with the lever out and the bike rolling in gear, up = ignition cut, down = auto-blip; the dogs swap in a
    // ~40-80 ms unloaded window (S.act). It never selects neutral, and pulling away still needs the lever.
    const ec = s.eclutch && b.autoClutch && S.cl < .6, qs = !ec && s.qs && b.qs !== false && S.cl < .6 && S.gear > 0 && Math.abs(S.v) > 2;
    if (S.shCD > 0) return; if (S.cl < .6 && !ec && !qs) { S.shCD = .3; say('Pull the clutch to shift', 900); blip('click'); return; }
    S.shCD = .15; let g = S.gear;
    if (s.pat === 'down') g = clamp(g + (d > 0 ? 1 : -1), 0, s.nG);
    else if (d > 0) g = g === 0 ? 2 : g === 1 ? (Math.abs(S.v) < .6 ? 0 : 2) : Math.min(s.nG, g + 1); else g = g <= 2 ? 1 : g - 1;
    if (g !== S.gear) {
      if (ec && S.gear && g) { if (g > S.gear) { S.act = .03; if (S.thr > .1) S.cutT = .1; } else S.act = .1; } else if (ec) S.act = .15;
      else if (qs) { if (g > S.gear) { S.act = .04; if (S.thr > .1) S.cutT = .06; } else { S.act = .08; S.qbT = .08; } }
      S.gear = g; blip('click');
    }
  },
  canStart(s, S, b) { if (S.gear && !b.autoClutch && S.cl < .7) return 'Pull the clutch or shift to N'; },
  top(s) { return Math.min(kph(s, s.prim * s.g[s.nG] * s.final, s.red), topV(s)); },
  stats(s, b) {
    const f = s.final, top = this.top(s);
    const pat = s.pat === 'down' ? `N-1-${Array.from({ length: s.nG - 1 }, (_, i) => i + 2).join('-')}, all down` : `1 down, ${s.nG - 1} up`;
    return `${s.nG}-speed, ${pat} · primary ${s.prim.toFixed(3)} · final drive ${f.toFixed(2)} · redline ${s.red} rpm<br>1st tops out ${kph(s, s.prim * s.g[1] * f, s.red).toFixed(0)} km/h · ${s.nG}th gearing ${kph(s, s.prim * s.g[s.nG] * f, s.red).toFixed(0)} km/h<br>Est. top speed ≈ ${top.toFixed(0)} km/h`;
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
    // YECVT (Yamaha NMAX / Aerox Tech MAX, part option yec: 1): an electric motor moves the drive pulley, so there are no rollers or
    // centre spring to tune. The ECU aims for the stock shift-rpm map (T mode), +s rpm in S mode, +lv rpm per Y-Shift level (3 levels),
    // and kicks down by `kick` rpm for a moment when the throttle is snapped open. cvt.ye holds those numbers.
    s.yec = s.yec && C.ye ? 1 : 0; if (s.yec) { s.ye = C.ye; s.vBase = V.base; s.yCsp = 1; }
  },
  reset(S) { S.gear = 0; S.pos = 0; S.issT = 0; S.issOff = false; S.ysh = 0; S.yOpen = false; S.yk = 0; S.yT0 = 0; },
  ratio(s, S) { return (s.lo + (s.hi - s.lo) * S.pos) * s.final; },
  eqRpm(s, pos, load) { return s.vBase * Math.sqrt((s.yec ? 1 : s.csp) * (s.vPre + s.vRise * pos) + s.vLoad * load); },
  clutch(s, S) {
    // shoe force ~ ω² minus the spring preload: starts biting at e0, fully locked by e1
    const f = clamp((S.rpm * S.rpm - s.e0 * s.e0) / (s.e1 * s.e1 - s.e0 * s.e0), 0, 1);
    S.c = f; return f * s.cap;
  },
  update(s, S, dt, Tdrive, b) {
    const load = clamp(Tdrive / (s.tqMax * s.pow), 0, 1); let eq = this.eqRpm(s, S.pos, load); const rate = s.vRate, dn = 2.5;
    if (s.yec) {
      const Y = s.ye;
      // Y-Shift drops out by itself when the rider brakes, or lets the throttle go after having opened it (Yamaha PH: "disengages
      // automatically when the rider releases the throttle or brakes"); a level set with the throttle shut holds for engine braking
      if (S.ysh) { if (S.brake > .3) S.ysh = 0; else if (S.thr > .15) S.yOpen = true; else if (S.yOpen && S.thr < .05) { S.ysh = 0; S.yOpen = false; } }
      if (S.thr - S.yT0 > 4 * dt && S.thr > .5) S.yk = 1; S.yT0 = S.thr; S.yk = Math.max(0, S.yk - dt / 1.5); // snap open: brief kick-down
      eq = Math.min(s.red - 300, eq + (b.ysp ? Y.s : Y.t) + Y.lv * S.ysh + Y.kick * S.yk); S.rpmEq = eq;
      // the ECU knows the rear pulley's speed, so it drives the pulley straight to the ratio that puts the engine on eq (no waiting
      // for the revs to answer, which with a slipping clutch would run the pulley to the stop). The motor moves the whole range in
      // ~1/rate s, gentle enough that the engine's own inertia does not lock the rear tyre on a Y-Shift.
      const need = eq * PI / 30 / Math.max(.1, Math.abs(S.v) / s.r) / s.final, tgt = S.v < .5 ? 0 : clamp((s.lo - need) / (s.lo - s.hi), 0, 1);
      S.pos = appr(S.pos, tgt, Y.rate * dt); return;
    }
    S.rpmEq = eq;
    // the belt can only move while the rear pulley turns; when stopped the torque spring pulls it back to low
    if (S.v < .5) S.pos = appr(S.pos, 0, dt * 1.5);
    else S.pos = clamp(S.pos + clamp(rate * (S.rpm - eq) / 1000, -dn, 1.2) * dt, 0, 1);
  },
  // runs before the engine is integrated, so a restart's rpm isn't overwritten in the same step
  pre(s, S, dt, b) {
    // Idling Stop: engine off after 3 s stopped at idle, restarts on throttle
    if (b.iss && S.running && S.warm > .6 && S.v < .1 && S.thr < .05 && S.rpm < s.idle + 400) { S.issT += dt; if (S.issT > 3) { S.running = false; S.issOff = true; } }
    else S.issT = 0;
    if (S.issOff && !S.running && S.key && !S.kill && S.thr > .05 && S.fuel > 0) { S.running = true; S.issOff = false; S.rpm = Math.max(S.rpm, s.idle + 200); }
    if (!b.iss && S.issOff) S.issOff = false;
  },
  // YECVT Y-Shift: down = one more level (max 3), up = one level back. Belt-only CVTs ignore the buttons.
  shift(s, S, d) {
    if (!s.yec || S.shCD > 0) return; S.shCD = .2;
    if (d < 0) { if (S.ysh >= 3) { say('Y-Shift 3 (max)', 700); return; } S.ysh++; S.yOpen = S.thr > .15; }
    else { if (!S.ysh) return; S.ysh--; }
    say(S.ysh ? 'Y-Shift ' + S.ysh : 'Y-Shift off', 700); blip('click');
  },
  canStart(s, S) { if (S.brake < .3) return 'Hold the brake to start'; },
  top(s) { return Math.min(kph(s, s.hi * s.final, s.red), topV(s)); },
  stats(s) {
    const top = this.top(s), Y = s.ye;
    if (s.yec) return `YECVT (motor-driven pulley) · ratio ${s.lo.toFixed(2)}–${s.hi.toFixed(2)} × final ${s.final.toFixed(3)} · redline ${s.red} rpm<br>T mode full-throttle shift rpm ≈ ${Math.round((this.eqRpm(s, 0, 1) + Y.t) / 50) * 50}–${Math.round((this.eqRpm(s, 1, 1) + Y.t) / 50) * 50}, S mode +${Y.s}, Y-Shift +${Y.lv} per level (3)<br>Clutch bites ${s.e0} rpm, locks ${s.e1} rpm · est. top speed ≈ ${top.toFixed(0)} km/h`;
    return `Ratio ${s.lo.toFixed(2)}–${s.hi.toFixed(2)} × final ${s.final.toFixed(2)} · redline ${s.red} rpm<br>Clutch bites ${s.e0} rpm, locks ${s.e1} rpm<br>Full-throttle shift rpm ≈ ${Math.round(this.eqRpm(s, 0, 1) / 50) * 50}–${Math.round(this.eqRpm(s, 1, 1) / 50) * 50}<br>Top ratio reaches ${kph(s, s.hi * s.final, s.red).toFixed(0)} km/h at redline · est. top speed ≈ ${top.toFixed(0)} km/h`;
  },
};

/* ---------- rotary: 4-speed rotary gearbox + automatic centrifugal clutch (Suzuki Smash-style "semi-auto") ---------- */
// No clutch lever. A centrifugal clutch bites as the revs rise (so it idles and pulls away in gear), and the gear pedal
// opens the clutch through its linkage while it is pressed. Rotary pattern N-1-2-3-4: from top the pedal goes round to
// N, which the gearbox only allows at a standstill.
const rotary = {
  ...manual,
  spec(s, bike, b) { manual.spec(s, bike, b); [s.e0, s.e1] = bike.manual.cent; s.e0 += s.eng; s.e1 += s.eng; },
  clutch(s, S) {
    const f = S.act > 0 ? 0 : clamp((S.rpm * S.rpm - s.e0 * s.e0) / (s.e1 * s.e1 - s.e0 * s.e0), 0, 1);
    S.lev = 1; S.c = f; return f * s.cap;
  },
  shift(s, S, d) {
    if (S.shCD > 0) return; S.shCD = .2; let g = S.gear;
    if (d > 0) { if (g < s.nG) g++; else if (Math.abs(S.v) < .6) g = 0; else { say('Stop to rotate into N', 900); return; } } else g = Math.max(0, g - 1);
    if (g !== S.gear) { S.gear = g; S.act = .18; blip('click'); } // pedal down: the linkage holds the clutch open
  },
  canStart() { },
  stats(s, b) { return manual.stats.call(this, { ...s, pat: 'rotary' }, b).replace(/1 down, \d+ up/, 'rotary N-1-2-3-4-N') + `<br>Centrifugal clutch bites ${s.e0} rpm, locks ${s.e1} rpm`; },
};

export const DRIVES = { manual, cvt, rotary };
