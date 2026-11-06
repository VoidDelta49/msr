// Effects on YOU (the player) from things you consume: data/shop.json items carry `fx: { key: amount }`, and each key is one handler
// below. Pure logic (no three.js, no DOM) so tools/interior.mjs runs it headless; main.js ticks it, foot.js / controls.js / renderer.js
// read it. A new kind of effect = one entry in FX (+ whatever reads it); a new item using existing effects = data only.
//
// Drunk (EF.drunk, 0 .. MAX): a ginbilog is most of the way there on its own. It wears off slowly (DECAY per second, faster above 1).
//   on foot   the stick turns under you, you sway sideways, can't sprint, walk slower (drunkWalk(), used by foot.js)
//   riding    steering is mostly the gin's, not yours, and long stretches of it are reversed; the throttle surges and dies, the brake
//             gets grabbed. However hard you fight it, at full drunk your hands decide less than a fifth of it (drunkRide(), controls.js)
//   screen    a wobbling, double-vision warp (renderer.js drunk pass), strength drunkK()
// Sober (fx.sober): coffee, water and pulutan take some of it away. Energy (fx.energy): seconds of faster sprinting on foot.
export const EF = { drunk: 0, energy: 0, t: 0, last: '' };
export const EFC = {
  MAX: 1.5,       // the most drunk you can get (more drinks past this do nothing)
  DECAY: .0042,   // per second below 1 (a full ginbilog, .8, lasts about three minutes)
  DECAY_HI: .012, // per second above 1 (the worst of it passes quicker)
};
// effect handlers: (amount) -> a short line for the message (or '')
export const FX = {
  drunk: v => { const was = EF.drunk; EF.drunk = Math.min(EFC.MAX, EF.drunk + v); return EF.drunk >= 1 && was < 1 ? 'The room is spinning' : EF.drunk > .45 ? "You're drunk" : 'Tipsy'; },
  sober: v => { if (EF.drunk <= 0) return ''; EF.drunk = Math.max(0, EF.drunk - v); return EF.drunk <= 0 ? 'Sober again' : 'A little clearer'; },
  energy: v => { EF.energy = Math.min(120, EF.energy + v); return 'Energy up'; },
};
// apply an item's fx object; unknown keys are reported (tools/interior.mjs fails on them before they ship)
export function applyFx(fx, err) {
  const out = [];
  for (const [k, v] of Object.entries(fx || {})) { const f = FX[k]; if (!f) { if (err) err.push('unknown effect ' + k); continue; } const s = f(+v || 0); if (s) out.push(s); }
  return out.join(' · ');
}
export function effTick(dt) {
  EF.t += dt;
  if (EF.drunk > 0) EF.drunk = Math.max(0, EF.drunk - (EF.drunk > 1 ? EFC.DECAY_HI : EFC.DECAY) * dt);
  if (EF.energy > 0) EF.energy = Math.max(0, EF.energy - dt);
}
export const effReset = () => { EF.drunk = 0; EF.energy = 0; };
// 0..1 strength of being drunk (the first sip already shows a little; .8 and up is "can't ride at all")
export const drunkK = () => { const d = Math.min(1, EF.drunk / .8); return d * d * (3 - 2 * d); };

// smooth pseudo-random wobble: a sum of incommensurate sines (deterministic in t, so the tests can replay it)
const wob = (t, a) => .55 * Math.sin(1.13 * t + a + .9 * Math.sin(.37 * t)) + .3 * Math.sin(2.71 * t + 1.7 * a) + .15 * Math.sin(5.3 * t + a * .3);

// On foot. k = drunkK(), t = walker clock. Returns how the walk is bent: ang = turn of the stick (rad), side = sideways push (m/s^2,
// to the walker's right), slow = speed factor, run = false when you can't sprint.
export function drunkWalk(k, t, o = {}) {
  o.ang = k * (.75 * wob(t * .8, 0) + .25 * Math.sin(t * 3.1));
  o.side = k * 3.2 * wob(t * .9, 2.1);
  o.slow = 1 - .35 * k; o.run = k < .45; o.turn = 1 - .6 * k;
  return o;
}
// On the bike. In: the rider's own steer (-1..1), throttle, brake; k = drunkK(), t = time. Out: what reaches the bike.
// Below k ~ .15 it's a slight weave you can hold; from .5 on you can't. "Fighting it" doesn't help: the rider's input is scaled down
// and flipped for long stretches, the gin's own steering is added on top and is always bigger.
export function drunkRide(steer, thr, brk, k, t, o = {}) {
  if (k <= 0) { o.steer = steer; o.thr = thr; o.brake = brk; return o; }
  const flip = Math.sin(.19 * t + 1.3) + .4 * Math.sin(.53 * t) > .25 ? -1 : 1;   // the bars go the wrong way for seconds at a time
  const own = 1 - Math.min(.82, k * 1.1);                                         // how much of your hands still counts
  const gin = Math.min(1, k * 1.25) * (wob(t * 1.4, .7) * 1.35 + .45 * Math.sin(t * 6.3) * k); // weave + a twitch
  o.steer = Math.max(-1, Math.min(1, steer * own * (k > .3 ? flip : 1) + gin));
  const surge = Math.max(0, wob(t * .9, 4.2)) * 1.6 * k;                          // the wrist opens on its own...
  const die = Math.sin(.77 * t + 2) > .92 ? k : 0;                                // ...and shuts
  o.thr = Math.max(0, Math.min(1, thr * (1 - .3 * k) * (1 - die) + surge));
  const grab = Math.sin(.41 * t + .6) + .5 * Math.sin(1.9 * t) > 1.32 ? k : 0;    // now and then a sudden handful of brake
  o.brake = Math.max(0, Math.min(1, brk * own + grab * .9));
  return o;
}
