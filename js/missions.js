// Quests: parking challenges, parcel delivery, food delivery, plus refuelling at the gas station.
// Quest hubs (changing every day; a coloured beacon in the world and a pin on the minimap) are scattered over the island's roads at random; ride into one and hold
// still to take the job. Some delivery hubs need a specific bike (red outline on the map): you are switched to it on the spot, harder time limit.
// A finished or failed hub moves somewhere else. The parking hub stays in the lot (the only place with bays).
//   parking: park in the green bay.
//   parcel:  carry the parcel to the drop-off. A crash, a hard wall hit or a swim and it falls off: game over.
//   gates:   Gate rush: thread a chain of gold gates, every gate buys time; the clock running out ends the run with what you got.
//   orbs:    Orb rush: grab the cyan orbs scattered around the hub before time is up.
//   radar:   Speed trap: blast through the orange halo as fast as you can; beat your own record on that bike.
//   stunt:   Stunt run: wheelies, stoppies and jumps score distance for 45 s; a crash ends the run with your points.
//   rogue:   Roguelite run: endless floors of mini trials (dash, orbs, tricks); fail one and you lose a heart; between floors ride through one of three coloured doors to pick a perk.
//   bomb:    Speed bomb: the bomb arms at 50 km/h and blows up if you stay under it for too long; reach the halo to defuse it.
//   meteor:  Meteor storm: warning halos appear on the ground and strike a moment later; stay out of them for 40 s.
//   hare:    Catch the hare: a glowing hare dashes over the island; stay inside its halo to catch it, it comes back faster.
//   food:    deliver before it goes cold; bumps, hard braking and sudden turns spoil it (still deliverable at 0%), a crash spills it.
import * as THREE from 'three';
import { $ } from './util.js';
import { S, ctx } from './state.js';
import { scene } from './renderer.js';
import { freeBays, marker, arrow, ROADS, H, atGas, LMF } from './world.js';
import { B } from './model.js';
import { say } from './hud.js';
import { blip } from './audio.js';

const TYPE = {
  park: { c: 0x3da5ff, css: '#3da5ff', g: 'P', name: 'Parking challenge' },
  parcel: { c: 0xd9a066, css: '#d9a066', g: 'B', name: 'Parcel delivery' },
  food: { c: 0xff5fa2, css: '#ff5fa2', g: 'F', name: 'Food delivery' },
  gates: { c: 0xffd23f, css: '#ffd23f', g: 'G', name: 'Gate rush' },
  orbs: { c: 0x3ad7ff, css: '#3ad7ff', g: 'O', name: 'Orb rush' },
  radar: { c: 0xff8a1f, css: '#ff8a1f', g: 'S', name: 'Speed trap' },
  stunt: { c: 0xd35bff, css: '#d35bff', g: 'T', name: 'Stunt run' },
  rogue: { c: 0x9be83a, css: '#9be83a', g: 'R', name: 'Roguelite run' },
  bomb: { c: 0xff3030, css: '#ff3030', g: 'X', name: 'Speed bomb' },
  meteor: { c: 0xe6efff, css: '#e6efff', g: 'M', name: 'Meteor storm' },
  hare: { c: 0x6670ff, css: '#6670ff', g: 'H', name: 'Catch the hare' },
};
const ARC = ['gates', 'orbs', 'stunt', 'rogue', 'bomb', 'meteor', 'hare'], MIN_KMH = 50, FUSE = 6, MR = 8, NMET = 6; // arcade job types, bomb arming speed and fuse (s), meteor radius (m) and how many can be falling
const PERK = [{ n: 'BLUE +5s a floor', c: 0x3da5ff }, { n: 'RED +♥', c: 0xff3d6e }, { n: 'GOLD magnet', c: 0xffd23f }, { n: 'WHITE shield', c: 0xffffff }];
const KIND = ['parcel', 'food', 'gates', 'orbs', 'radar', 'stunt', 'rogue', 'bomb', 'meteor', 'hare'], NGATE = 8, NORB = 10, ORB_R = 4, STUNT_T = 45; // hub job types, gates / orbs per run, orb pickup radius (m), stunt run length (s)
const NHUB = 14, TOWN_HUBS = 3, SEP = 140, SEE = 800, HARD = .85, BIKE_P = .35; // delivery hubs, how many start in town, min spacing (m), beacon draw range, time factor of bike-locked jobs, share of them
const HUBS = [{ id: 'park', ...LMF.lot[0].W(28, 29), y: LMF.lot[0].y }];
for (let i = 0; i < NHUB; i++) HUBS.push({ id: 'parcel', x: 0, z: 0, y: 0, placed: false });
const HR = 5, DR = 6;   // hub / drop-off radius (m)
// food spoilage tuning: loss in % per second = (measure - threshold) * k, each measure capped
export const K = {
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
const destB = beacon(0x43e07a, DR), nextB = beacon(0xffd23f, DR), orbB = Array.from({ length: NORB }, () => beacon(0x3ad7ff, ORB_R)), metB = Array.from({ length: NMET }, () => beacon(0xe6efff, MR)), hareB = beacon(0x6670ff, 12), ALLB = [destB, nextB, hareB, ...orbB, ...metB];
const PO = { polygonOffset: true, polygonOffsetFactor: -2 }, bm = (c, o, x) => new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: o, ...x });
const ringG = new THREE.RingGeometry(HR - .6, HR, 40).rotateX(-Math.PI / 2), hardG = new THREE.RingGeometry(HR + .6, HR + 1.3, 40).rotateX(-Math.PI / 2);
// Every hub slot's ring, beam and red outer ring (bike-locked jobs) live in two BatchedMeshes (Build 11.43): all the rings in
// one, all the beams in the other, the type colour per instance. Two draws for every beacon in view instead of 2-3 each.
const RB = new THREE.BatchedMesh(HUBS.length * 2, ringG.attributes.position.count + hardG.attributes.position.count, ringG.index.count + hardG.index.count, bm(0xffffff, .75, PO));
const BB = new THREE.BatchedMesh(HUBS.length, beamG.attributes.position.count, beamG.index.count, bm(0xffffff, .3));
const gRing = RB.addGeometry(ringG), gHard = RB.addGeometry(hardG), gBeam = BB.addGeometry(beamG), hc = new THREE.Color(), hm = new THREE.Matrix4();
for (const M of [RB, BB]) { M.frustumCulled = false; M.name = 'hubs'; scene.add(M); } // hubs move: three culls each instance, not the whole batch
for (const h of HUBS) { // per slot: instance ids + the old group's interface (visible, place)
  const r = RB.addInstance(gRing), hr = RB.addInstance(gHard), bz = BB.addInstance(gBeam); let vis = true, hard = false; RB.setColorAt(hr, hc.set(0xff4a3d)); BB.setColorAt(bz, hc); // colour textures exist before the warm-up compiles the shaders
  h.b = {
    set visible(v) { if (v === vis) return; vis = v; RB.setVisibleAt(r, v); BB.setVisibleAt(bz, v); RB.setVisibleAt(hr, v && hard); },
    place(x, y, z, id, bike) {
      hard = !!bike; RB.setColorAt(r, hc.set(TYPE[id].c)); BB.setColorAt(bz, hc); RB.setVisibleAt(hr, vis && hard);
      RB.setMatrixAt(r, hm.makeTranslation(x, y + .1, z)); RB.setMatrixAt(hr, hm); BB.setMatrixAt(bz, hm.makeScale(1, bike ? 2 : 1, 1).setPosition(x, y, z));
    },
  };
  h.b.visible = false;
}
function crate(w, h, c, stripe, lid) {
  const g = new THREE.Group(), m = c => new THREE.MeshLambertMaterial({ color: c });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), m(c)), new THREE.Mesh(new THREE.BoxGeometry(.06, h + .01, w + .01).translate(0, h / 2, 0), m(stripe)));
  if (lid) g.add(new THREE.Mesh(new THREE.BoxGeometry(w + .03, .04, w + .03).translate(0, h, 0), m(lid)));
  g.visible = false; scene.add(g); return g;
}
const ITEM = { parcel: crate(.34, .26, 0xc9965a, 0xe8d9b0), food: crate(.36, .32, 0xff5fa2, 0xffffff, 0xffc2dc) };

// the layout is seeded by the date (Philippine day, UTC+8): everyone gets the same hubs on the same day and they change at midnight.
// A moved hub is seeded by day + slot + how often it moved, so it stays deterministic per player.
const DAY = Math.floor((Date.now() + 8 * 36e5) / 864e5);
const mul = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let rng = mul(DAY * 2654435761), ready = false, roadP = null;
const bikeName = id => (ctx.bikes[id] && ctx.bikes[id].name) || id, label = h => TYPE[h.id].name + (h.bike ? ' · ' + bikeName(h.bike) + ' only' : '');
function place(h, town) { // a random road spot, away from the other hubs
  roadP = roadP || ROADS.flatMap(r => r.kind === 'strip' || !r.s ? [] : r.s.filter((_, i) => i % 2 === 0));
  for (let k = 0; k < 300; k++) {
    const p = roadP[(rng() * roadP.length) | 0];
    if (town && !(Math.abs(p.x) < 200 && Math.abs(p.z) < 100)) continue;
    if (HUBS.some(o => o !== h && o.placed !== false && Math.hypot(o.x - p.x, o.z - p.z) < SEP)) continue;
    h.x = p.x; h.z = p.z; h.y = p.h; h.placed = true; return;
  }
}
function setup(h, town) { // roll position, job type and bike requirement
  const ids = Object.keys(ctx.bikes); h.placed = false; place(h, town); if (!h.placed) place(h, false);
  h.id = KIND[(rng() * KIND.length) | 0]; h.bike = rng() < BIKE_P && ids.length > 1 ? ids[(rng() * ids.length) | 0] : null;
  Object.assign(h, TYPE[h.id]); h.b.place(h.x, h.y, h.z, h.id, h.bike);
}
function init() { // needs road samples / ground height, so not at import time
  ready = true; Object.assign(HUBS[0], TYPE.park, { y: H(28, 29) }); HUBS[0].b.place(28, HUBS[0].y, 29, 'park', null);
  HUBS.forEach((h, i) => i && setup(h, i <= TOWN_HUBS)); pins(null);
}
export function pins(list) { // minimap pins: [{x, z, c, g, h}]; the map shows the ones in view plus the 3 nearest at its rim
  MI.n = (MI.n | 0) + 1; MI.pins = list || HUBS.map(h => ({ x: h.x, z: h.z, c: h.css, g: h.g, h: !!h.bike })); MI.pk = (list ? 'q' : 'idle') + MI.n;
}

/* ---------- carried item ---------- */
const cap = (v, m) => Math.min(Math.abs(v), m), falls = [], rnd = (a, b) => a + Math.random() * (b - a);
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
pNext.onclick = () => { if (MI.q && MI.q.type === 'park') start(MI.q.hub); };
pX.onclick = endQuest;

/* ---------- quest flow ---------- */
function pickDest(hub, min, max) {
  const c = [];
  for (const r of ROADS) { if (r.kind === 'strip' || !r.s) continue; for (let i = 0; i < r.s.length; i += 3) { const p = r.s[i], d = Math.hypot(p.x - hub.x, p.z - hub.z); if (d > min && d < max) c.push(p); } }
  return c.length ? c[(Math.random() * c.length) | 0] : { x: 0, z: -80 };
}
function start(h) {
  const id = h.id; lastTxt = '';
  if (h.bike && ctx.bike.id !== h.bike && ctx.switchBikeHere) ctx.switchBikeHere(h.bike); // bike-locked job: swap bikes right here
  const q = MI.q = { type: id, phase: 'on', t: 0, hold: 0, h0: S.hits, hub: h };
  if (id === 'park') {
    const b = q.bay = freeBays[(Math.random() * freeBays.length) | 0]; const by = LMF.lot[0].y; marker.position.set(b.x, by + .03, b.z); marker.rotation.y = b.ry || 0; arrow.position.set(b.x, by + 2.2, b.z); MI.ay = by;
    marker.material.color.set(0x43e07a); arrow.material.color.set(0x43e07a); marker.visible = arrow.visible = true; destB.visible = false;
    pins([{ x: b.x, z: b.z, c: '#43e07a', g: '' }]); say('Park in the green bay'); return;
  }
  if (ARC.includes(id)) return startArcade(q, h);
  if (id === 'radar') { // a runway to build speed on, then the trap
    const d = q.dest = pickDest(h, 250, 650), gy = d.h ?? H(d.x, d.z); q.t = 0; q.rec = +(localStorage.getItem('cpm.radar.' + ctx.bike.id) || 0);
    destB.position.set(d.x, gy, d.z); destB.visible = true; arrow.position.set(d.x, gy + 2.2, d.z); MI.ay = gy; arrow.material.color.set(TYPE.radar.c); arrow.visible = true; marker.visible = false;
    destB.children.forEach(m => m.material.color.set(TYPE.radar.c)); pins([{ x: d.x, z: d.z, c: TYPE.radar.css, g: '' }]);
    say('Speed trap! Hit the orange halo flat out' + (q.rec ? ' · record ' + q.rec + ' km/h' : ''), 2800); return;
  }
  const food = id === 'food', d = q.dest = pickDest(h, food ? 120 : 150, food ? 520 : 800), gy = d.h ?? H(d.x, d.z), hf = h.bike ? HARD : 1;
  q.d0 = Math.hypot(d.x - S.x, d.z - S.z); q.limit = (30 + q.d0 * 1.5 / 7.5) * hf; q.par = (20 + q.d0 * 1.35 / 9) * hf; // seconds: food gets cold / parcel three-star time
  Object.assign(q, foodNew(), { heat: 100, lx: S.x, lz: S.z });
  q.item = ITEM[id]; carryOn(q.item);
  destB.position.set(d.x, gy, d.z); destB.visible = true; arrow.position.set(d.x, gy + 2.2, d.z); MI.ay = gy; arrow.material.color.set(0x43e07a); arrow.visible = true; marker.visible = false;
  pins([{ x: d.x, z: d.z, c: '#43e07a', g: '' }]);
  say((food ? 'Food picked up! Deliver it hot and in one piece' : 'Parcel loaded! Don\'t drop it') + (h.bike ? ' · ' + bikeName(h.bike) + ' job, tighter time' : ''), 2800);
}
const gate = (b, p, c) => { b.position.set(p.x, p.h ?? H(p.x, p.z), p.z); b.children.forEach(m => m.material.color.set(c)); b.visible = true; };
function startArcade(q, h) { // gates / orbs / stunt share one entry: a clock, a score and (gates, orbs) glowing targets
  const id = q.type, hf = h.bike ? HARD : 1; q.t = q.score = 0; q.best = 0;
  if (id === 'gates') {
    q.left = 28 * hf; q.pts = [h]; for (let i = 0; i < NGATE; i++) q.pts.push(pickDest(q.pts[i], 90, 200));
    q.pts.shift(); q.n = 0; gate(destB, q.pts[0], TYPE.gates.c); gate(nextB, q.pts[1], 0xfff1a8); arrow.position.set(q.pts[0].x, (q.pts[0].h ?? H(q.pts[0].x, q.pts[0].z)) + 2.2, q.pts[0].z); arrow.material.color.set(TYPE.gates.c); arrow.visible = true;
    pins(q.pts.slice(0, 2).map(p => ({ x: p.x, z: p.z, c: TYPE.gates.css, g: '' }))); say('Gate rush! Every gate buys time', 2500);
  } else if (id === 'orbs') {
    q.left = 45 * hf; q.pts = []; for (let i = 0; i < NORB; i++) { const p = pickDest(h, 15, 170); q.pts.push(p); gate(orbB[i], p, TYPE.orbs.c); }
    q.got = 0; pins(q.pts.map(p => ({ x: p.x, z: p.z, c: TYPE.orbs.css, g: '' }))); say('Orb rush! Grab them all', 2500);
  } else if (id === 'stunt') { q.left = STUNT_T * hf; q.run = q.air = 0; q.lx = S.x; q.lz = S.z; pins([]); say('Stunt run! Wheelies, stoppies and jumps score', 2500); }
  else if (id === 'bomb') {
    const d = q.dest = pickDest(h, 400, 900); q.fuse = FUSE; q.armed = false; q.bp = 0; q.par = (30 + Math.hypot(d.x - S.x, d.z - S.z) / 16) * hf; gate(destB, d, TYPE.bomb.c);
    arrow.position.set(d.x, (d.h ?? H(d.x, d.z)) + 2.2, d.z); MI.ay = d.h ?? H(d.x, d.z); arrow.material.color.set(TYPE.bomb.c); arrow.visible = true; pins([{ x: d.x, z: d.z, c: TYPE.bomb.css, g: '' }]);
    say(`Speed bomb strapped on! It arms at ${MIN_KMH} km/h: don't slow down`, 3000);
  } else if (id === 'meteor') { q.left = 40 * hf; q.hp = 3; q.m = []; q.sp = 1; pins([]); say('Meteor storm! Stay out of the halos', 2500); }
  else if (id === 'hare') {
    q.left = 50 * hf; q.catch = q.meter = 0; q.hare = { ...pickDest(h, 60, 120), v: 13 }; q.hare.t = pickDest(q.hare, 80, 200); hareB.visible = true; say('Catch the hare! Stay in its halo', 2500);
  } else { q.hp = 3; q.floor = q.cleared = 0; q.pk = [0, 0, 0, 0]; rogueTrial(q); say('Roguelite run! Clear floors, pick a door, last as long as you can', 3000); }
}
const trickOf = () => S.air ? 'JUMP' : (S.wp || 0) > .12 ? 'WHEELIE' : (S.wp || 0) < -.12 ? 'STOPPIE' : '', hearts = n => '♥'.repeat(n) + '♡'.repeat(Math.max(0, 3 - n)), ahead = (p, m) => ({ x: p.x - Math.sin(S.psi) * m, z: p.z - Math.cos(S.psi) * m });
function rogueTrial(q) { // a new floor: a random mini trial that gets harder every floor
  const f = ++q.floor, k = q.tk = ['dash', 'orbs', 'trick'][(Math.random() * 3) | 0], ramp = 1 - Math.min(.35, f * .03), hf = q.hub.bike ? HARD : 1, bonus = q.pk[0] * 5; q.ph = 'trial'; q.acc = 0; ALLB.forEach(b => b.visible = false); q.pts = [];
  if (k === 'dash') { const d = pickDest(S, 100, 140 + f * 25), L = Math.hypot(d.x - S.x, d.z - S.z); q.pts = [d]; q.tl = (L / 10 + 8) * ramp * hf + bonus; gate(destB, d, TYPE.rogue.c); }
  else if (k === 'orbs') { const n = Math.min(NORB - 1, 3 + (f >> 1)); for (let i = 0; i < n; i++) { const p = pickDest(S, 15, 120); q.pts.push(p); gate(orbB[i], p, TYPE.orbs.c); } q.tl = (10 + n * 4) * ramp * hf + bonus; }
  else { q.need = 25 + f * 8; q.tl = 25 * hf + bonus; q.lx = S.x; q.lz = S.z; }
  pins(q.pts.map(p => ({ x: p.x, z: p.z, c: TYPE.rogue.css, g: '' })));
}
function rogueDoors(q) { // three random perks, one door each, a little way ahead
  q.ph = 'door'; ALLB.forEach(b => b.visible = false); const a = PERK.map((_, i) => i).sort(() => Math.random() - .5).slice(0, 3), c = ahead(S, 45);
  q.pts = a.map((k, i) => { const p = { x: c.x - Math.cos(S.psi) * (i - 1) * 18, z: c.z + Math.sin(S.psi) * (i - 1) * 18, k }; gate(orbB[i], p, PERK[k].c); return p; });
  pins(q.pts.map(p => ({ x: p.x, z: p.z, c: '#' + PERK[p.k].c.toString(16).padStart(6, '0'), g: '' }))); say('Pick a door!', 1200);
}
function rogueLose(q) { // a failed floor: the shield (perk 3) soaks it, else a heart goes
  blip('crunch', 8); if (q.pk[3]) { q.pk[3]--; say('The shield took the hit!', 1200); } else { q.hp--; say('Floor failed! -♥', 1200); }
  if (q.hp <= 0) return finish(q, 'RUN OVER', stars(q.cleared, 8, 4), `${q.cleared} floors`);
  rogueDoors(q);
}
function endQuest() {
  const q = MI.q; if (!q) return;
  if (q.item && q.phase === 'on') { dropItem(q.item); say('Job cancelled'); }
  if (q.item && q.phase === 'done') dropItem(q.item);
  marker.visible = arrow.visible = false; ALLB.forEach(b => b.visible = false); destB.children.forEach(m => m.material.color.set(0x43e07a)); pnl.hidden = true; MI.q = null; MI.arm = false;
  if (q.hub !== HUBS[0] && q.phase !== 'on') { rng = mul(DAY * 2654435761 + HUBS.indexOf(q.hub) * 40503 + (q.hub.n = (q.hub.n | 0) + 1) * 7919); setup(q.hub, false); } // a finished job's hub moves elsewhere (a cancelled one stays)
  pins(null);
}
function spill(g, sink, dtL, lx, lz) { // the item sinks, or flies off the way the bike was moving
  if (sink) return dropItem(g);
  const dt = Math.max(.008, dtL || .016), vx = (S.x - lx) / dt, vz = (S.z - lz) / dt, k = Math.min(1, 25 / Math.max(1, Math.hypot(vx, vz)));
  fling(g, vx * k + rnd(-1.5, 1.5), rnd(2, 4.5), vz * k + rnd(-1.5, 1.5));
}
function fail(msg, sink) {
  const q = MI.q; q.phase = 'fail'; MI.res = msg; say(msg, 3000); arrow.visible = destB.visible = false; pins([]);
  if (q.item) spill(q.item, sink, q.dtL, q.lx, q.lz);
}
// race.js (parcel / food races) carries the same crates and uses the same spoilage rules
export const cargo = {
  on(type) { const g = ITEM[type]; if (g.parent !== B.ct) carryOn(g); },
  off(type) { dropItem(ITEM[type]); },
  lose(type, sink, dtL, lx, lz) { spill(ITEM[type], sink, dtL, lx, lz); },
};
export const foodNew = () => ({ quality: 100, sa: 0, pv: S.v, pl: S.lean, pf: S.cF, pr: S.cR });
export function foodJolt(q, dt) { // jolts measured at 30 Hz so they don't depend on the frame rate
  q.sa += dt; if (q.sa < 1 / 30) return;
  const h = q.sa, aL = (S.v - q.pv) / h, lr = (S.lean - q.pl) / h, hz = Math.max(Math.abs(S.cF - q.pf), Math.abs(S.cR - q.pr)) / h; q.sa = 0; q.pv = S.v; q.pl = S.lean; q.pf = S.cF; q.pr = S.cR;
  const fast = Math.abs(S.v) > 3, aY = Math.abs(S.v * S.yaw);
  const loss = Math.max(0, cap(aL, K.cL) - K.aL) * K.kL + (fast ? Math.max(0, cap(aY, K.cY) - K.aY) * K.kY + Math.max(0, cap(lr, K.cS) - K.lr) * K.kS : 0) + Math.max(0, cap(hz, K.cZ) - K.hz) * K.kZ;
  q.quality = Math.max(0, q.quality - loss * h); if (loss * h > 1.2) say('Easy! The food is sloshing', 500);
}
ctx.onHit = dv => { // rapier.js: a wall / object bump of dv m/s (a crash with Tough Biker off is caught through S.crashed instead)
  if (ctx.raceHit) ctx.raceHit(dv);
  const q = MI.q; if (!q || q.phase !== 'on' || !q.item) return;
  if (dv > 7) return fail(q.type === 'food' ? 'Food everywhere! Game over' : 'The parcel flew off! Game over');
  if (q.type === 'food') { q.quality = Math.max(0, q.quality - K.hit - dv * K.kH); say('Ouch! The food took a hit', 700); }
};

/* ---------- per-frame ---------- */
function idle(dt) {
  let near = null; for (const h of HUBS) if (Math.hypot(S.x - h.x, S.z - h.z) < HR) near = h;
  if (!MI.arm) { if (!HUBS.some(h => Math.hypot(S.x - h.x, S.z - h.z) < HR + 4)) MI.arm = true; MI.hold = 0; return; } // after a quest: leave the hub first
  if (!near || S.crashed) { MI.hold = 0; return; }
  if (Math.abs(S.v) > 1.5) { MI.hold = 0; if (Math.abs(S.v) < 4) say(label(near) + ': stop here to start', 350); return; } // no message when just riding past
  MI.hold += dt; say(label(near) + ': hold still...', 350); if (MI.hold > .8) { MI.hold = 0; start(near); }
}
function parkTick(q, dt) {
  if (q.phase !== 'on') return panel(MI.res, true, 'OK');
  q.t += dt; const b = q.bay, hits = S.hits - q.h0, bc = Math.cos(b.ry || 0), bs = Math.sin(b.ry || 0), ba = (S.x - b.x) * bc - (S.z - b.z) * bs, bd = (S.x - b.x) * bs + (S.z - b.z) * bc, ok = Math.abs(ba) < .4 && Math.abs(bd) < .8 && Math.abs(Math.cos(S.psi + (b.ry || 0))) > .94 && Math.abs(S.v) < .15;
  q.hold = ok ? q.hold + dt : 0; marker.material.color.set(ok ? 0xffd23f : 0x43e07a);
  panel(`PARK · ${q.t.toFixed(1)}s · hits ${hits} · ${Math.hypot(S.x - b.x, S.z - b.z).toFixed(0)}m`, false, '✕');
  if (q.hold > 1.2) {
    q.phase = 'done'; const st = hits === 0 && q.t < 40 ? '★★★' : hits <= 1 && q.t < 70 ? '★★☆' : '★☆☆'; MI.res = `PARKED ${st} · ${q.t.toFixed(1)}s · hits ${hits}`;
    say('PARKED! ' + st, 2500); blip('ok'); arrow.visible = false; pins([]);
  }
}
function deliveryTick(q, dt) {
  if (q.phase !== 'on') return panel(MI.res, false, 'OK');
  if (q.item.parent !== B.ct) carryOn(q.item); // bike model rebuilt
  q.t += dt;
  if (q.hub.bike && ctx.bike.id !== q.hub.bike) { say('Wrong bike: job cancelled'); return endQuest(); }
  if (S.crashed) return fail(q.type === 'food' ? 'You crashed and spilled the food! Game over' : 'You crashed and the parcel fell out! Game over');
  if (S.wet) return fail('Lost it in the water! Game over', true);
  const food = q.type === 'food', dist = Math.hypot(S.x - q.dest.x, S.z - q.dest.z);
  if (food) {
    q.heat = Math.max(0, 100 * (1 - q.t / q.limit)); foodJolt(q, dt);
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
function finish(q, head, st, say2) { q.phase = 'done'; MI.res = `${head} ${st} · ${say2}`; say(head + '! ' + st, 2500); blip('ok'); arrow.visible = false; ALLB.forEach(b => b.visible = false); pins([]); }
const stars = (v, a, b) => v >= a ? '★★★' : v >= b ? '★★☆' : '★☆☆';
function arcadeTick(q, dt) { // gates, orbs, stunt (radar is a delivery-style dash, see below)
  if (q.phase !== 'on') return panel(MI.res, false, 'OK');
  q.t += dt; q.left -= dt; const id = q.type, near = p => Math.hypot(S.x - p.x, S.z - p.z) < (id === 'orbs' ? ORB_R : DR);
  if (id === 'gates') {
    const g = q.pts[q.n]; panel(`GATES ${q.n}/${NGATE} · ${Math.max(0, q.left).toFixed(1)}s · ${Math.hypot(S.x - g.x, S.z - g.z).toFixed(0)} m`, false, '✕');
    if (near(g)) {
      q.n++; const bonus = Math.max(4, Math.hypot(g.x - (q.pts[q.n - 2] || q.hub).x, g.z - (q.pts[q.n - 2] || q.hub).z) / 14); q.left += bonus; blip('ok'); say(`Gate ${q.n}! +${bonus.toFixed(0)}s`, 700);
      if (q.n >= NGATE) return finish(q, 'ALL GATES', '★★★', `${q.t.toFixed(1)}s`);
      gate(destB, q.pts[q.n], TYPE.gates.c); const nx = q.pts[q.n + 1]; nextB.visible = !!nx; if (nx) gate(nextB, nx, 0xfff1a8);
      arrow.position.x = q.pts[q.n].x; arrow.position.z = q.pts[q.n].z; MI.ay = q.pts[q.n].h ?? H(q.pts[q.n].x, q.pts[q.n].z); pins(q.pts.slice(q.n, q.n + 2).map(p => ({ x: p.x, z: p.z, c: TYPE.gates.css, g: '' })));
    } else if (q.left <= 0) return finish(q, 'TIME UP', stars(q.n, 7, 4), `${q.n} gates`);
  } else if (id === 'orbs') {
    for (let i = 0; i < NORB; i++) if (q.pts[i] && near(q.pts[i])) { q.pts[i] = null; orbB[i].visible = false; q.got++; q.left += 1; blip('ok'); say(`Orb ${q.got}/${NORB}! +1s`, 500); pins(q.pts.filter(Boolean).map(p => ({ x: p.x, z: p.z, c: TYPE.orbs.css, g: '' }))); }
    panel(`ORBS ${q.got}/${NORB} · ${Math.max(0, q.left).toFixed(1)}s`, false, '✕');
    if (q.got >= NORB) return finish(q, 'ALL ORBS', '★★★', `${q.t.toFixed(1)}s`);
    if (q.left <= 0) return finish(q, 'TIME UP', stars(q.got, 8, 5), `${q.got}/${NORB} orbs`);
  } else if (id === 'stunt') {
    const d = Math.hypot(S.x - q.lx, S.z - q.lz); q.lx = S.x; q.lz = S.z;
    const trick = trickOf(); // a clean trick scores its distance, and the longer the combo the bigger the multiplier
    if (trick) { q.run += dt; q.score += d * (1 + Math.min(q.run, 6) / 3); q.last = trick; } else if (q.run) { if (q.run > 1.5) say(`${q.last} combo x${(1 + Math.min(q.run, 6) / 3).toFixed(1)}!`, 900); q.run = 0; }
    panel(`STUNT ${q.score | 0} pts · ${Math.max(0, q.left).toFixed(0)}s` + (trick ? ` · ${trick} x${(1 + Math.min(q.run, 6) / 3).toFixed(1)}` : ''), false, '✕');
    if (S.crashed) return finish(q, 'WIPEOUT', stars(q.score, 400, 150), `${q.score | 0} pts`);
    if (q.left <= 0) finish(q, 'STUNT RUN', stars(q.score, 400, 150), `${q.score | 0} pts`);
  } else if (id === 'bomb') {
    const kmh = Math.abs(S.v) * 3.6, d = Math.hypot(S.x - q.dest.x, S.z - q.dest.z);
    if (!q.armed && kmh >= MIN_KMH) { q.armed = true; say('BOMB ARMED! Keep moving!', 1500); blip('click'); }
    if (q.armed) { if (kmh < MIN_KMH) { q.fuse -= dt; if ((q.bp -= dt) <= 0) { q.bp = .1 + .6 * q.fuse / FUSE; blip('click'); } } else q.fuse = Math.min(FUSE, q.fuse + dt * .5); }
    panel(q.armed ? `BOMB ${q.fuse.toFixed(1)}s · ${kmh | 0}/${MIN_KMH} km/h · ${d.toFixed(0)} m` : `BOMB · reach ${MIN_KMH} km/h to arm`, false, '✕');
    if (d < DR) return finish(q, 'DEFUSED', stars(-q.t, -q.par, -q.par * 1.4), `${q.t.toFixed(1)}s`);
    if (q.fuse <= 0 || S.crashed) { blip('crunch', 12); fail('BOOM! The bomb went off! Game over'); }
  } else if (id === 'meteor') {
    q.sp -= dt; const free = metB.findIndex((_, i) => !q.m[i]);
    if (q.sp <= 0 && free >= 0) { q.sp = Math.max(.45, 1.5 - q.t / 35); const a = ahead(S, Math.abs(S.v) * 1.3); q.m[free] = { x: a.x + rnd(-10, 10), z: a.z + rnd(-10, 10), t: 1.4 }; }
    q.m.forEach((m, i) => {
      if (!m) return; m.t -= dt; gate(metB[i], m, (m.t * 8 | 0) % 2 ? 0xffffff : 0xff3030); if (m.t > 0) return;
      const hit = Math.hypot(S.x - m.x, S.z - m.z); metB[i].visible = false; q.m[i] = null; blip('crunch', 12);
      if (hit < MR) { q.hp--; S.v *= .35; say(q.hp ? `BOOM! Direct hit ${hearts(q.hp)}` : 'BOOM!', 900); } else if (hit < MR + 7) say('Close one!', 500);
    });
    panel(`METEORS ${hearts(q.hp)} · ${Math.max(0, q.left).toFixed(0)}s`, false, '✕');
    if (q.hp <= 0) return finish(q, 'FLATTENED', stars(q.t, 35, 20), `${q.t.toFixed(0)}s`);
    if (q.left <= 0) finish(q, 'SURVIVED', stars(q.hp, 3, 2), hearts(q.hp));
  } else if (id === 'hare') {
    const r = q.hare, dx = r.t.x - r.x, dz = r.t.z - r.z, L = Math.hypot(dx, dz);
    if (L < 4) r.t = pickDest(r, 80, 200); else { r.x += dx / L * r.v * dt; r.z += dz / L * r.v * dt; }
    gate(hareB, r, TYPE.hare.c); const d = Math.hypot(S.x - r.x, S.z - r.z); q.meter = d < 12 ? q.meter + dt / 2 : Math.max(0, q.meter - dt / 4);
    pins([{ x: r.x, z: r.z, c: TYPE.hare.css, g: '' }]); panel(`HARE ${q.catch} · ${Math.max(0, q.left).toFixed(0)}s · CATCH ${Math.min(100, q.meter * 100) | 0}% · ${d.toFixed(0)} m`, false, '✕');
    if (q.meter >= 1) { q.catch++; q.left += 5; q.meter = 0; blip('ok'); say(`Caught the hare #${q.catch}! +5s, it's faster now`, 1200); Object.assign(r, pickDest(S, 100, 220), { v: Math.min(26, 13 + q.catch * 2) }); r.t = pickDest(r, 80, 200); }
    if (q.left <= 0) finish(q, 'HARE RUN', stars(q.catch, 5, 3), `${q.catch} caught`);
  } else {
    const tr = q.tk, f = q.floor, mag = 2 * q.pk[2], head = `FLOOR ${f} ${hearts(q.hp)}`;
    if (q.ph === 'door') {
      panel(`${head} · DOOR: ${q.pts.map(p => PERK[p.k].n).join(' · ')}`, false, '✕'); const p = q.pts.find(p => Math.hypot(S.x - p.x, S.z - p.z) < ORB_R + 2);
      if (p) { if (p.k === 1) q.hp = Math.min(5, q.hp + 1); else q.pk[p.k]++; blip('ok'); say(PERK[p.k].n + '!', 1200); rogueTrial(q); }
      return;
    }
    q.tl -= dt; let done = false, txt = '';
    if (tr === 'dash') { const d = Math.hypot(S.x - q.pts[0].x, S.z - q.pts[0].z); done = d < DR + mag; txt = `DASH ${d.toFixed(0)} m`; }
    else if (tr === 'orbs') { for (let i = 0; i < q.pts.length; i++) if (q.pts[i] && Math.hypot(S.x - q.pts[i].x, S.z - q.pts[i].z) < ORB_R + mag) { q.pts[i] = null; orbB[i].visible = false; blip('ok'); q.tl += 1; } done = q.pts.every(p => !p); txt = `ORBS ${q.pts.filter(Boolean).length} left`; pins(q.pts.filter(Boolean).map(p => ({ x: p.x, z: p.z, c: TYPE.rogue.css, g: '' }))); }
    else { const d = Math.hypot(S.x - q.lx, S.z - q.lz); q.lx = S.x; q.lz = S.z; if (trickOf()) q.acc += d; done = q.acc >= q.need; txt = `TRICKS ${q.acc | 0}/${q.need} m`; }
    panel(`${head} · ${txt} · ${Math.max(0, q.tl).toFixed(1)}s`, false, '✕');
    if (S.crashed) return rogueLose(q); if (done) { q.cleared++; blip('ok'); say(`Floor ${f} clear!`, 800); rogueDoors(q); } else if (q.tl <= 0) rogueLose(q);
  }
}
function radarTick(q, dt) {
  if (q.phase !== 'on') return panel(MI.res, false, 'OK');
  q.t += dt; const kmh = Math.abs(S.v) * 3.6, d = Math.hypot(S.x - q.dest.x, S.z - q.dest.z);
  if (S.crashed) return fail('Wiped out before the radar! Game over');
  panel(`SPEED TRAP · ${kmh | 0} km/h · ${d.toFixed(0)} m` + (q.rec ? ` · record ${q.rec}` : ''), false, '✕');
  if (d < DR) {
    const k = Math.round(kmh), rec = q.rec; if (k > rec) try { localStorage.setItem('cpm.radar.' + ctx.bike.id, k); } catch (e) {}
    finish(q, rec && k > rec ? 'NEW RECORD' : 'CLOCKED', rec ? stars(k, rec, rec * .9) : '★★☆', `${k} km/h` + (rec && k <= rec ? ` (record ${rec})` : ''));
  }
}
export function missions(dt) {
  const fuelCap = ctx.spec.fuel.cap;
  if (atGas(S.x, S.z) && Math.abs(S.v) < .2 && S.fuel < fuelCap) { S.fuel = Math.min(fuelCap, S.fuel + .5 * dt); say('Refueling... ' + (S.fuel / fuelCap * 100 | 0) + '%', 400); }
  fallTick(dt); const q = MI.q;
  if (!q) idle(dt); else if (q.type === 'park') parkTick(q, dt); else if (q.type === 'radar') radarTick(q, dt); else if (q.item) deliveryTick(q, dt); else arcadeTick(q, dt);
}
export function animMarker(now) {
  if (!ready) init();
  const on = !MI.q; for (const h of HUBS) h.b.visible = on && Math.abs(S.x - h.x) < SEE && Math.abs(S.z - h.z) < SEE && Math.hypot(S.x - h.x, S.z - h.z) < SEE; // beacons only near the player
  if (arrow.visible) { arrow.position.y = MI.ay + 2.2 + Math.sin(now * 3) * .25; arrow.rotation.y = now * 2; }
}
