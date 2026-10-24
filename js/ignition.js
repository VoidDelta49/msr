// Starting sequence, as on a real fuel-injected bike.
//  1. KEY ON: the dash wakes (needle sweep) and the fuel pump primes for ~2 s.
//  2. Kill switch on RUN, fuel in the tank, tip-over latch clear (a crash trips the bank-angle sensor: cycle the key).
//  3. Interlocks (drivetrain.canStart): manual bikes need neutral or the clutch lever in, the scooter needs the brake held.
//  4. HOLD START: the starter spins the engine at ~200-280 rpm (compression chugs). The ECU only fires once the pump has
//     primed and the throttle is shut; a cold engine takes longer to catch. Cranking past 5 s overheats the starter.
//  5. Catch: a flare, then a cold fast idle that settles as the engine warms (the Click's Idling Stop waits for warm too).
// Carburetted engines (spec.carb) have no pump to prime, but crank longer when cold (choke).
import { S, ctx } from './state.js';
import { clamp } from './util.js';
import { say } from './hud.js';
import { blip, crank } from './audio.js';

const PRIME = 1.8, CRANK_MAX = 5, REST = 6, SWEEP = 1.5;
let ph = 0, thrWarned = false;

const halt = () => { S.running = false; S.issOff = false; };

// why the starter won't turn right now ('' / undefined = it will)
export function startBlock() {
  if (!S.key) return 'Turn the key on first (K)';
  if (S.tip) return 'Tip-over sensor tripped: turn the key off, then on';
  if (S.kill) return 'Kill switch is on STOP (T)';
  if (S.fuel <= 0) return 'Out of fuel. Push it to the gas station.';
  if (S.stT > 0) return 'Let the starter rest a moment';
  return ctx.drive.canStart(ctx.spec, S, ctx.bcfg);
}

export function keySwitch() {
  blip('click');
  if (S.key) { S.key = false; S.cranking = false; S.cr = 0; if (S.running) halt(); S.issOff = false; say('Ignition OFF', 900); return; }
  S.key = true; S.keyT = 0; S.tip = false; if (!ctx.spec.carb) blip('pump'); say('Ignition ON', 900);
}

export function killSwitch() {
  S.kill = !S.kill; blip('click'); if (S.kill && S.running) halt();
  say(S.kill ? 'Kill switch: STOP' : 'Kill switch: RUN', 900);
}

// START button / R key: down = 1 begins cranking (while held), 0 releases
export function starter(down) {
  S.cr = down ? 1 : 0; if (!down) return;
  if (S.running) return say('Engine already running', 800); // real bikes lock the starter out
  const why = startBlock(); if (why) say(why, 1600);
}

// garage stand / bike swap in place: skip the ritual (engine running and warm enough)
export function quickStart() {
  S.key = true; S.keyT = Math.max(S.keyT || 0, PRIME); S.kill = false; S.tip = false; S.cranking = false; S.cr = 0;
  S.running = true; S.issOff = false; S.rpm = Math.max(S.rpm, 1700); S.warm = Math.max(S.warm || 0, .6);
}

// tachometer reading: live rpm, or the self-test sweep right after the key goes on
export function dispRpm(sp) {
  if (S.running) return S.rpm;
  if (S.key && S.keyT < SWEEP) return sp.tachMax * Math.sin(Math.PI * S.keyT / SWEEP);
  return 0;
}

// before the engine is integrated: timers, engine temperature, cranking, catching
export function igPre(dt) {
  const sp = ctx.spec, prime = sp.carb ? 0 : PRIME;
  if (S.key) S.keyT += dt; if (S.stT > 0) S.stT -= dt;
  if (S.running && (!S.key || S.kill)) halt();
  S.warm = S.running ? Math.min(1, S.warm + dt * (.006 + .012 * clamp(S.rpm / sp.red, 0, 1))) : Math.max(0, S.warm - dt * .0015);
  S.fi = S.running ? (1 - S.warm) * .4 * sp.idle : 0; // cold fast idle, added to the idle target in physics.step
  if (S.cr && !S.running && !startBlock()) {
    if (!S.cranking) { S.cranking = true; S.cT = 0; thrWarned = false; if (S.keyT < prime) say('Fuel pump still priming…', 1200); }
    S.cT += dt; crank(true);
    if (S.cT >= .55 + (1 - S.warm) * (sp.carb ? 1.8 : 1.1) && S.keyT >= prime && S.thr < .3) { // catches
      S.cranking = false; S.running = true; S.issOff = false; S.rpm = sp.idle + 700 + (1 - S.warm) * 900;
      blip('pop'); setTimeout(() => blip('pop'), 90); say('Engine on', 900);
    } else if (S.cT > CRANK_MAX) { S.cranking = false; S.cr = 0; S.stT = REST; say('Starter overheated. Let it rest.', 2200); }
    else if (S.thr >= .3 && S.cT > 1 && !thrWarned) { thrWarned = true; say('Close the throttle to start', 1400); }
  } else S.cranking = false;
}

// after the drivetrain: while cranking the starter, not the wheel, sets the engine speed
export function igPost(dt) {
  if (!S.cranking) return;
  const base = 190 + 90 * S.warm; // thick cold oil turns slower
  ph += dt * Math.PI * 2 * base / 120 * Math.max(1, ctx.spec.sound?.cyl || 1);
  S.rpm = base * (1 + .3 * Math.sin(ph));
}
