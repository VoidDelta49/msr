// Going into buildings, buying, drinking, playing pool: the glue between the walker (foot.js), the context button (act.js), interiors
// (interior.js + interiorfig.js), shops (shop.js + shopui.js) and what you consume (effects.js). Data: data/interiors.json, data/shop.json.
//   ENTER   at the front door of a building type that has an interior: the walker moves into its pocket room and walks the room's
//           floor and walls (footEnv swap); EXIT at the door inside brings you back to the step outside, the island's ground back
//   ORDER   at a counter inside (an interior's 'shops'), BUY at a walk-up store's front door (a shop's 'doors'): the shop panel
//   SHOOT   at a pool table: the cue ball goes away from where you stand (break first); drunk, your aim wanders. RACK when all are down
//   DRINK   whatever you carry (bought, or a friend's treat): the drink animation, then its effects (drunk, sober, energy)
import * as THREE from 'three';
import { BUILD } from './config.js';
import { S, ctx } from './state.js';
import { camera, DRUNK, drunkFx, MB } from './renderer.js';
import { DOORS, H, OBBS } from './world.js';
import { F, footEnv, footEnvNow } from './foot.js';
import { addAct } from './act.js';
import { IN, interiorEnv, interiorFor, pocket, enterPos, exitPos, interact, aimFrom, breakSpeed, camFit, pocketKey } from './interior.js';
import { showRoom, hideRoom, roomFrame } from './interiorfig.js';
import { footCamSnap } from './footfig.js';
import { poolStep, shoot, rack, left } from './pool.js';
import { SHOP, shopEnv, walkup, item, use, next, shopOf } from './shop.js';
import { SU, openShop, closeShop, draw as shopDraw } from './shopui.js';
import { EF, effTick, drunkK } from './effects.js';
import { say } from './hud.js';
import { blip } from './audio.js';

const [ID, SD] = await Promise.all(['interiors', 'shop'].map(f => fetch(`data/${f}.json?v=${BUILD}`).then(r => r.json())));
interiorEnv(ID); shopEnv(SD); export const SHOPD = SD;
// doors you can do something at from outside: go in, or buy at the front
const ENTER = DOORS.filter(d => interiorFor(d.t)), STORE = DOORS.filter(d => walkup(d.t));
ctx.pocketOf = (x, y, z) => pocketKey(x, y, z, ENTER, H); // net.js: which room a friend's walker is in
ctx.placeName = key => { const P = IN.cache.get(key); return P ? P.def.name : ''; };
const pick = a => Array.isArray(a) ? a[(Math.random() * a.length) | 0] : a || '';
let outEnv = null, far0 = camera.far, pending = null, hicT = 8, wasFoot = false, warned = 0;

/* ---------- the walker's camera stays out of buildings (footfig.js footCam fit) ---------- */
// outside: the boom (target -> camera) is cut where it would enter a building footprint (world.js OBBS, the ones within 12 m), so stepping
// out of a door or backing up to a wall doesn't put the camera inside the walls. Inside, interior.js camFit keeps it in the room.
function outFit(tx, ty, tz, cx, cy, cz) {
  const dx = cx - tx, dz = cz - tz, L = Math.hypot(dx, dz); if (L < .05) return 1; let t = 1;
  for (const b of OBBS) {
    if (Math.abs(b.cx - tx) > 12 || Math.abs(b.cz - tz) > 12 || b.hx < .6 || b.hz < .6) continue; // small things (posts, rails) don't block the view
    const ox = tx - b.cx, oz = tz - b.cz, lx = ox * b.c + oz * b.s, lz = -ox * b.s + oz * b.c, ux = dx * b.c + dz * b.s, uz = -dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) continue; // the walker is inside this box (a doorway): ignore it
    let t0 = 0, t1 = 1; for (const [o, u, h] of [[lx, ux, b.hx], [lz, uz, b.hz]]) { if (Math.abs(u) < 1e-9) { if (Math.abs(o) > h) { t0 = 2; break; } continue; } let a = (-h - o) / u, c = (h - o) / u; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); }
    if (t0 <= t1 && t0 < t) t = t0;
  }
  return t < 1 ? Math.max(.12, t - .3 / L) : 1;
}
ctx.camFit = outFit;

/* ---------- in and out ---------- */
function enter(door) {
  if (!F.on || ctx.inside) return; const id = interiorFor(door.t), P = pocket(id, door, H(door.x, door.z)), e = enterPos(P);
  outEnv = footEnvNow(); footEnv({ H: () => P.oy, SEA: -1e9, OBBS: P.boxes, noBike: true });
  Object.assign(F, { x: e.x, y: e.y, z: e.z, vx: 0, vy: 0, vz: 0, psi: e.psi, cy: e.psi, gnd: true, spd: 0, rs: 0 });
  ctx.inside = P; ctx.camFit = (tx, ty, tz, cx, cy, cz) => camFit(P, tx, ty, tz, cx, cy, cz); showRoom(P); footCamSnap(); // no easing across the 300 m jump
  far0 = camera.far; camera.far = Math.max(P.w, P.d) * 3; camera.updateProjectionMatrix(); if (MB) MB.cut();
  blip('door'); say(`${P.def.name} · walk up to the counter to order, a table to play`, 2800); drunkFx(); // build the drunk pass now, while you look around
}
export function leave(quiet) {
  const P = ctx.inside; if (!P) return; closeShop(); const e = exitPos(P);
  if (outEnv) footEnv(outEnv); outEnv = null; ctx.inside = null; ctx.camFit = outFit; hideRoom();
  camera.far = far0; camera.updateProjectionMatrix(); if (MB) MB.cut();
  if (F.on) { Object.assign(F, { x: e.x, y: H(e.x, e.z), z: e.z, vx: 0, vy: 0, vz: 0, psi: e.psi, cy: e.psi, gnd: true, spd: 0 }); footCamSnap(); }
  if (!quiet) { blip('door'); say('Back outside', 1200); }
}
ctx.exitInside = leave; // main.js: reset / bike switch while inside

/* ---------- drink / eat ---------- */
export function consume(id) {
  const I = item(id); if (!I) return;
  if (!F.on) return say('Get off the bike first', 1500);
  if (F.animT > 0 && F.anim === 'drink') return; F.anim = 'drink'; F.animT = 1.5; pending = id; blip('gulp'); // a drink cuts a wave / shot short
}
SU.onUse = consume;
function finishUse(id) {
  const I = item(id), r = use(id); if (!r.ok) return;
  say(`${I.icon} "${pick(I.line)}"${r.msg ? ' · ' + r.msg : ''}`, 2600); if (EF.drunk > 0) drunkFx(); shopDraw();
}
ctx.consume = consume; ctx.carry = () => next();

/* ---------- pool ---------- */
function poolAct(a) {
  const t = a.t, T = t.T;
  if (!left(T)) { rack(T); blip('ball', 2); return say('Racked. Break!', 1400); }
  const wob = (Math.random() - .5) * 1.4 * drunkK() + (Math.random() - .5) * .04, [dx, dz] = aimFrom(t, a.qx, a.qz, wob);
  if (!shoot(T, dx, dz, breakSpeed(t) * (1 - .25 * drunkK() * Math.random()))) return;
  F.anim = 'cue'; F.animT = .7; blip('ball', 3);
  if (drunkK() > .5 && Math.random() < .3) say(pick(['Whoa, which ball…', 'Two cue balls?', 'Miscue!']), 1200);
}

/* ---------- context actions (act.js) ---------- */
addAct(() => { // inside: exit, order, play
  const P = ctx.inside; if (!P || !F.on) return null; const a = interact(P, F.x, F.z); if (!a || a.label === '…') return null;
  if (a.k === 'exit') return { label: 'EXIT', pri: 1, d: a.d, run: () => leave() };
  if (a.k === 'shop') return { label: 'ORDER', pri: 1, d: a.d, run: () => SU.open ? closeShop() : openShop(a.shop, { x: F.x, z: F.z, r: 2.2 }) };
  return { label: a.label, pri: 1, d: a.d, run: () => poolAct(a) };
}, 'inside');
addAct(() => { // outside: go in / buy at the door
  if (ctx.inside || !F.on || !F.gnd) return null; let best = null, bd = 2.1, buyAt = false;
  for (const d of ENTER) { const e = Math.hypot(d.x - F.x, d.z - F.z); if (e < bd) { bd = e; best = d; buyAt = false; } }
  for (const d of STORE) { const e = Math.hypot(d.x - F.x, d.z - F.z); if (e < bd) { bd = e; best = d; buyAt = true; } }
  if (!best || Math.abs(F.y - H(best.x, best.z)) > 1.5) return null; const door = best;
  return buyAt ? { label: 'BUY', pri: 2, d: bd, run: () => SU.open ? closeShop() : openShop(walkup(door.t), { x: F.x, z: F.z, r: 2.6 }) } : { label: 'ENTER', pri: 2, d: bd, run: () => enter(door) };
}, 'doors');
addAct(() => { const id = F.on && !(F.animT > 0) ? next() : null; if (!id) return null; const I = item(id); return { label: (I.use || 'USE') + ' ' + I.icon, pri: 8, d: 0, run: () => consume(id) }; }, 'carry');

/* ---------- per frame (main.js, while playing) ---------- */
const ev = [];
export function placesFrame(dt, t) {
  effTick(dt); const k = drunkK(); F.dk = F.on ? k : 0;
  const was = DRUNK.k; DRUNK.k = k; DRUNK.t = EF.t; if (was > .01 && k <= .01 && MB) MB.cut(); // sober again: the motion blur history is stale
  if (F.animT > 0) { F.animT -= dt; if (F.animT <= 0) { F.animT = 0; F.anim = ''; if (pending) { const id = pending; pending = null; finishUse(id); } } }
  if (k > .4 && (hicT -= dt) < 0) { hicT = 6 + Math.random() * 10; blip('hic'); }
  if (wasFoot && !F.on && k > .3 && t - warned > 30) { warned = t; say("You're drunk. You won't keep it upright…", 2600); } wasFoot = F.on;
  if (SU.open && (!F.on || (SU.from && Math.hypot(F.x - SU.from.x, F.z - SU.from.z) > SU.from.r))) closeShop();
  const P = ctx.inside; if (!P) return;
  let snd = 0;
  for (const tb of P.tables) {
    ev.length = 0; poolStep(tb.T, Math.min(dt, .05), ev);
    for (const e of ev) {
      if (snd > 2) break;
      if (e.k === 'pot') { snd++; blip('pocket'); if (e.n === 9) say('Nine-ball! 🎱 Rack won', 2200); else if (e.n === 0) say('Scratch!', 1200); else if (!left(tb.T)) say('Table cleared! RACK them again', 2000); }
      else if (e.k === 'click' && e.v > .15) { snd++; blip('ball', e.v); } else if (e.k === 'bank' && e.v > .5) { snd++; blip('cushion', e.v); }
    }
  }
  roomFrame(dt, t);
}
export { SHOP, shopOf };
