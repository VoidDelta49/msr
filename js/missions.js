// Quests: parking challenges, parcel delivery, food delivery, plus refuelling at the gas station.
// Each quest type has a hub (a coloured beacon in the world and a pin on the minimap). Ride into it and hold still to take the job.
//   parking: park in the green bay.
//   parcel:  carry the parcel to the drop-off. A crash, a hard wall hit or a swim and it falls off: game over.
//   food:    deliver before it goes cold; bumps, hard braking and sudden turns spoil it (still deliverable at 0%), a crash spills it.
import * as THREE from 'three';
import { $ } from './util.js';
import { S, ctx } from './state.js';
import { scene } from './renderer.js';
import { freeBays, marker, arrow, ROADS, H } from './world.js';
import { B } from './model.js';
import { say } from './hud.js';
import { blip } from './audio.js';

const HUBS = [
  { id: 'park', x: 28, z: 29, c: 0x3da5ff, css: '#3da5ff', g: 'P', name: 'Parking challenge' },
  { id: 'parcel', x: -40, z: 0, c: 0xd9a066, css: '#d9a066', g: 'B', name: 'Parcel delivery' },
  { id: 'food', x: 120, z: 80, c: 0xff5fa2, css: '#ff5fa2', g: 'F', name: 'Food delivery' },
];
const HR = 5, DR = 6;   // hub / drop-off radius (m)
// food spoilage tuning: loss in % per second = (measure - threshold) * k, each measure capped
const K = {
  aL: 4.0, kL: 2.5, cL: 12,   // braking / acceleration, m/s^2 (a scooter launch is ~4.4, a hard stop ~8)
  aY: 2.0, kY: 4, cY: 10,     // lateral acceleration v*yawrate, m/s^2 (fast corners)
  lr: .8, kS: 60, cS: 4,      // lean rate, rad/s: swerving (normal cornering is < .4)
  hz: .8, kZ: 60, cZ: 6,      // suspension compression rate, m/s: bumps and landings (smooth road < .2, a speed bump at 30 km/h ~2.7)
  hit: 5, kH: 3,              // wall/object bump: loss = hit + dv * kH (%)
};

export const MI = ctx.MI = { q: null, pins: [], pk: 'idle', arm: true, ay: 0, res: '' };

/* ---------- world objects (all created at load, hidden, so the shader warm-up covers them) ---------- */
const beamG = new THREE.CylinderGeometry(1.1, 1.1, 40, 10, 1, true).translate(0, 20, 0);
export function beacon(c, r) {
  const g = new THREE.Group(), pm = { color: c, transparent: true, depthWrite: false, side: THREE.DoubleSide };
  const ring = new THREE.Mesh(new THREE.RingGeometry(r - .6, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...pm, opacity: .75, polygonOffset: true, polygonOffsetFactor: -2 }));
  ring.position.y = .1; g.add(ring, new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ ...pm, opacity: .3 })));
  g.visible = false; scene.add(g); return g;
}
const hubB = HUBS.map(h => beacon(h.c, HR)), destB = beacon(0x43e07a, DR);
function crate(w, h, c, stripe, lid) {
  const g = new THREE.Group(), m = c => new THREE.MeshLambertMaterial({ color: c });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), m(c)), new THREE.Mesh(new THREE.BoxGeometry(.06, h + .01, w + .01).translate(0, h / 2, 0), m(stripe)));
  if (lid) g.add(new THREE.Mesh(new THREE.BoxGeometry(w + .03, .04, w + .03).translate(0, h, 0), m(lid)));
  g.visible = false; scene.add(g); return g;
}
const ITEM = { parcel: crate(.34, .26, 0xc9965a, 0xe8d9b0), food: crate(.36, .32, 0xff5fa2, 0xffffff, 0xffc2dc) };

let ready = false;
function init() { // needs the ground height, so not at import time
  ready = true; HUBS.forEach((h, i) => hubB[i].position.set(h.x, H(h.x, h.z), h.z)); showHubs(true); pins(null);
}
function showHubs(on) { hubB.forEach(b => b.visible = on); }
export function pins(list) { // minimap pins: [{x, z, c, g}]
  MI.pins = list || HUBS.map(h => ({ x: h.x, z: h.z, c: h.css, g: h.g })); MI.pk = list ? 'q' + ((list[0] && list[0].x * 7 + list[0].z) | 0) : 'idle';
}

/* ---------- carried item ---------- */
const falls = [], rnd = (a, b) => a + Math.random() * (b - a);
function carryOn(g) {
  const k = falls.findIndex(f => f.g === g); if (k >= 0) falls.splice(k, 1);
  const c = B.cargo || { y: .9, z: .5 }; B.ct.add(g); g.position.set(0, c.y, c.z); g.rotation.set(0, 0, 0); g.visible = true;
}
function dropItem(g) { g.visible = false; if (g.parent === B.ct) B.ct.remove(g); }
function fling(g, vx, vy, vz) { // the item leaves the bike and tumbles to the ground
  g.updateWorldMatrix(true, false); scene.attach(g); g.visible = true; falls.push({ g, vx, vy, vz, wx: rnd(-7, 7), wz: rnd(-7, 7), t: 0 });
}
function fallTick(dt) {
  for (let i = falls.length - 1; i >= 0; i--) {
    const f = falls[i], g = f.g, p = g.position; f.t += dt; f.vy -= 9.8 * dt; p.x += f.vx * dt; p.y += f.vy * dt; p.z += f.vz * dt;
    const gy = H(p.x, p.z);
    if (p.y < gy) { p.y = gy; f.vy = f.vy < -1 ? -f.vy * .35 : 0; const fr = Math.max(0, 1 - 4 * dt); f.vx *= fr; f.vz *= fr; f.wx *= .6; f.wz *= .6; }
    if (f.vy === 0) { const e = Math.max(0, 1 - 5 * dt); g.rotation.x *= e; g.rotation.z *= e; }
    g.rotation.x += f.wx * dt; g.rotation.z += f.wz * dt;
    if (f.t > 10) { g.visible = false; falls.splice(i, 1); }
  }
}

/* ---------- panel ---------- */
const pnl = $('mis'), pT = $('misT'), pNext = $('misNext'), pX = $('misX'); let lastTxt = '';
function panel(txt, next, x) { if (txt !== lastTxt) { pT.textContent = txt; lastTxt = txt; } pNext.hidden = !next; pX.textContent = x; pnl.hidden = false; }
pNext.onclick = () => { if (MI.q && MI.q.type === 'park') start('park'); };
pX.onclick = endQuest;

/* ---------- quest flow ---------- */
function pickDest(hub, min, max) {
  const c = [];
  for (const r of ROADS) { if (r.kind === 'strip' || !r.s) continue; for (let i = 0; i < r.s.length; i += 3) { const p = r.s[i], d = Math.hypot(p.x - hub.x, p.z - hub.z); if (d > min && d < max) c.push(p); } }
  return c.length ? c[(Math.random() * c.length) | 0] : { x: 0, z: -80 };
}
function start(id) {
  showHubs(false); lastTxt = '';
  const q = MI.q = { type: id, phase: 'on', t: 0, hold: 0, h0: S.hits };
  if (id === 'park') {
    const b = q.bay = freeBays[(Math.random() * freeBays.length) | 0]; marker.position.set(b.x, .03, b.z); arrow.position.set(b.x, 2.2, b.z); MI.ay = 0;
    marker.material.color.set(0x43e07a); arrow.material.color.set(0x43e07a); marker.visible = arrow.visible = true; destB.visible = false;
    pins([{ x: b.x, z: b.z, c: '#43e07a', g: '' }]); say('Park in the green bay'); return;
  }
  const hub = HUBS.find(h => h.id === id), food = id === 'food', d = q.dest = pickDest(hub, food ? 120 : 150, food ? 520 : 800), gy = H(d.x, d.z);
  q.d0 = Math.hypot(d.x - S.x, d.z - S.z); q.limit = 30 + q.d0 * 1.5 / 7.5; q.par = 20 + q.d0 * 1.35 / 9; // seconds: food gets cold / parcel three-star time
  Object.assign(q, { quality: 100, heat: 100, sa: 0, pv: S.v, pl: S.lean, pf: S.cF, pr: S.cR, lx: S.x, lz: S.z });
  q.item = ITEM[id]; carryOn(q.item);
  destB.position.set(d.x, gy, d.z); destB.visible = true; arrow.position.set(d.x, gy + 2.2, d.z); MI.ay = gy; arrow.material.color.set(0x43e07a); arrow.visible = true; marker.visible = false;
  pins([{ x: d.x, z: d.z, c: '#43e07a', g: '' }]);
  say(food ? 'Food picked up! Deliver it hot and in one piece' : 'Parcel loaded! Don\'t drop it', 2600);
}
function endQuest() {
  const q = MI.q; if (!q) return;
  if (q.item && q.phase === 'on') { dropItem(q.item); say('Job cancelled'); }
  if (q.item && q.phase === 'done') dropItem(q.item);
  marker.visible = arrow.visible = destB.visible = false; pnl.hidden = true; MI.q = null; MI.arm = false; showHubs(true); pins(null);
}
function fail(msg, sink) {
  const q = MI.q; q.phase = 'fail'; MI.res = msg; say(msg, 3000); arrow.visible = destB.visible = false; pins([]);
  const g = q.item; if (!g) return;
  if (sink) return dropItem(g);
  const dt = Math.max(.008, q.dtL || .016), vx = (S.x - q.lx) / dt, vz = (S.z - q.lz) / dt, k = Math.min(1, 25 / Math.max(1, Math.hypot(vx, vz)));
  fling(g, vx * k + rnd(-1.5, 1.5), rnd(2, 4.5), vz * k + rnd(-1.5, 1.5));
}
ctx.onHit = dv => { // rapier.js: a wall / object bump of dv m/s (a crash with Tough Biker off is caught through S.crashed instead)
  const q = MI.q; if (!q || q.phase !== 'on' || q.type === 'park') return;
  if (dv > 7) return fail(q.type === 'food' ? 'Food everywhere! Game over' : 'The parcel flew off! Game over');
  if (q.type === 'food') { q.quality = Math.max(0, q.quality - K.hit - dv * K.kH); say('Ouch! The food took a hit', 700); }
};

/* ---------- per-frame ---------- */
function idle(dt) {
  let near = null; for (const h of HUBS) if (Math.hypot(S.x - h.x, S.z - h.z) < HR) near = h;
  if (!MI.arm) { if (!HUBS.some(h => Math.hypot(S.x - h.x, S.z - h.z) < HR + 4)) MI.arm = true; MI.hold = 0; return; } // after a quest: leave the hub first
  if (!near || S.crashed) { MI.hold = 0; return; }
  if (Math.abs(S.v) > 1.5) { MI.hold = 0; if (Math.abs(S.v) < 4) say(near.name + ': stop here to start', 350); return; } // no message when just riding past
  MI.hold += dt; say(near.name + ': hold still...', 350); if (MI.hold > .8) { MI.hold = 0; start(near.id); }
}
function parkTick(q, dt) {
  if (q.phase !== 'on') return panel(MI.res, true, 'OK');
  q.t += dt; const b = q.bay, hits = S.hits - q.h0, ok = Math.abs(S.x - b.x) < .4 && Math.abs(S.z - b.z) < .8 && Math.abs(Math.cos(S.psi)) > .94 && Math.abs(S.v) < .15;
  q.hold = ok ? q.hold + dt : 0; marker.material.color.set(ok ? 0xffd23f : 0x43e07a);
  panel(`PARK · ${q.t.toFixed(1)}s · hits ${hits} · ${Math.hypot(S.x - b.x, S.z - b.z).toFixed(0)}m`, false, '✕');
  if (q.hold > 1.2) {
    q.phase = 'done'; const st = hits === 0 && q.t < 40 ? '★★★' : hits <= 1 && q.t < 70 ? '★★☆' : '★☆☆'; MI.res = `PARKED ${st} · ${q.t.toFixed(1)}s · hits ${hits}`;
    say('PARKED! ' + st, 2500); blip('ok'); arrow.visible = false; pins([]);
  }
}
const cap = (v, m) => Math.min(Math.abs(v), m);
function deliveryTick(q, dt) {
  if (q.phase !== 'on') return panel(MI.res, false, 'OK');
  if (q.item.parent !== B.ct) carryOn(q.item); // bike model rebuilt
  q.t += dt;
  if (S.crashed) return fail(q.type === 'food' ? 'You crashed and spilled the food! Game over' : 'You crashed and the parcel fell out! Game over');
  if (S.wet) return fail('Lost it in the water! Game over', true);
  const food = q.type === 'food', dist = Math.hypot(S.x - q.dest.x, S.z - q.dest.z);
  if (food) {
    q.heat = Math.max(0, 100 * (1 - q.t / q.limit)); q.sa += dt;
    if (q.sa >= 1 / 30) { // jolts measured at 30 Hz so they don't depend on the frame rate
      const h = q.sa, aL = (S.v - q.pv) / h, lr = (S.lean - q.pl) / h, hz = Math.max(Math.abs(S.cF - q.pf), Math.abs(S.cR - q.pr)) / h; q.sa = 0; q.pv = S.v; q.pl = S.lean; q.pf = S.cF; q.pr = S.cR;
      const fast = Math.abs(S.v) > 3, aY = Math.abs(S.v * S.yaw);
      const loss = Math.max(0, cap(aL, K.cL) - K.aL) * K.kL + (fast ? Math.max(0, cap(aY, K.cY) - K.aY) * K.kY + Math.max(0, cap(lr, K.cS) - K.lr) * K.kS : 0) + Math.max(0, cap(hz, K.cZ) - K.hz) * K.kZ;
      q.quality = Math.max(0, q.quality - loss * h); if (loss * h > 1.2) say('Easy! The food is sloshing', 500);
    }
    if (q.heat <= 0) return fail('The food went cold! Game over');
  }
  q.dtL = dt; q.lx = S.x; q.lz = S.z;
  const stop = dist < DR && Math.abs(S.v) < 1.2; q.hold = stop ? q.hold + dt : 0;
  panel((food ? `FOOD ${q.quality | 0}% · HEAT ${q.heat | 0}%` : `PARCEL · ${q.t.toFixed(0)}s`) + ` · ${dist.toFixed(0)} m` + (dist < DR && !stop ? ' · STOP' : ''), false, '✕');
  if (q.hold > .6) {
    q.phase = 'done'; const hits = S.hits - q.h0;
    const st = food ? (q.quality >= 80 && q.heat >= 35 ? '★★★' : q.quality >= 50 && q.heat >= 10 ? '★★☆' : '★☆☆') : (hits === 0 && q.t < q.par ? '★★★' : hits <= 2 && q.t < q.par * 1.6 ? '★★☆' : '★☆☆');
    MI.res = `DELIVERED ${st} · ` + (food ? `FOOD ${q.quality | 0}% · HEAT ${q.heat | 0}%` : `${q.t.toFixed(1)}s · hits ${hits}`);
    say('DELIVERED! ' + st, 2500); blip('ok'); dropItem(q.item); arrow.visible = destB.visible = false; pins([]);
  }
}
export function missions(dt) {
  const fuelCap = ctx.spec.fuel.cap;
  if (Math.abs(S.x + 40) < 6 && Math.abs(S.z - 40) < 3.5 && Math.abs(S.v) < .2 && S.fuel < fuelCap) { S.fuel = Math.min(fuelCap, S.fuel + .5 * dt); say('Refueling... ' + (S.fuel / fuelCap * 100 | 0) + '%', 400); }
  fallTick(dt); const q = MI.q;
  if (!q) idle(dt); else if (q.type === 'park') parkTick(q, dt); else deliveryTick(q, dt);
}
export function animMarker(now) {
  if (!ready) init();
  if (arrow.visible) { arrow.position.y = MI.ay + 2.2 + Math.sin(now * 3) * .25; arrow.rotation.y = now * 2; }
}
