// Pedestrians: drawing, messages and the ride (the brains are npc.js, the people's looks data/npc.json, the bodies figure.js).
// Draw calls for the whole crowd, whatever its size: people 1, dogs 1, contact shadows 1, leashes 1, "needs a ride" markers 1,
// a passenger on your bike 1. Every figure is posed on the GPU (figure.js), nothing casts into the sun's shadow map, people
// outside the view frustum are not even written to the instance buffers, and the brains run at a lower rate far away.
// How many people: Options > Game > Pedestrians (Off / Few / Normal / Busy) x the graphics preset's pool x fewer at night.
import * as THREE from 'three';
import { instancedBufferAttribute, uv, smoothstep, vec3 } from 'three/tsl';
import { scene, camera } from './renderer.js';
import { cfg, Q, BUILD } from './config.js';
import { S, ctx } from './state.js';
import { H, SEA, OBBS, ROADS, DOORS } from './world.js';
import { B } from './model.js';
import { F } from './foot.js';
import { say } from './hud.js';
import { blip } from './audio.js';
import { beacon, MI } from './missions.js';
import { earn } from './shop.js';
import { setWaypoint, clearWaypoint, WP } from './map.js';
import { lampsOn } from './lights.js';
import { NPC, npcEnv, npcStep, poseOf } from './npc.js';
import { Crowd, humanGeo, dogGeo, POSES, footDrop, dogDrop, handAt, DIMS, joints } from './figure.js';

const D = await (await fetch('data/npc.json?v=' + BUILD)).json();
export const NPCD = D;
npcEnv({ H, SEA, OBBS, ROADS, DOORS, data: D });

const lite = !!Q.lite, CAP = Math.ceil(Math.max(...Object.values(D.pool)) * Math.max(...Object.values(D.density))) + 8;
const HUM = humanGeo(DIMS), J = joints(DIMS);
const people = new Crowd(HUM, CAP, { name: 'npcs', lite }), dogs = new Crowd(dogGeo(), 32, { name: 'npcDogs', lite });
const pax = new Crowd(HUM, 1, { name: 'npcPassenger', lite }); // on your bike (child of the bike body, so it leans and pitches with it)
for (const c of [people, dogs]) { c.commit(); scene.add(c.mesh); }
pax.commit(); B.body.add(pax.mesh); pax.mesh.visible = false;

// contact shadows: a soft dark disc under every figure (like the bikes' blobs)
const SH_N = CAP + 32, shK = new THREE.InstancedBufferAttribute(new Float32Array(SH_N), 1); shK.setUsage(THREE.DynamicDrawUsage);
const shMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
{ const q = uv().sub(.5); shMat.colorNode = vec3(0); shMat.opacityNode = smoothstep(0, .6, q.mul(2).length().oneMinus()).mul(.42).mul(instancedBufferAttribute(shK)); }
const SH = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shMat, SH_N); SH.name = 'npcShadows'; SH.frustumCulled = false; SH.instanceMatrix.setUsage(THREE.DynamicDrawUsage); SH.count = 1; scene.add(SH);
// leashes: one line per dog, owner's hand to collar
const LE = new THREE.BufferGeometry(), leP = new THREE.BufferAttribute(new Float32Array(32 * 6), 3); leP.setUsage(THREE.DynamicDrawUsage); LE.setAttribute('position', leP); LE.setDrawRange(0, 2);
const LEASH = new THREE.LineSegments(LE, new THREE.LineBasicMaterial({ color: 0x1d1a18 })); LEASH.frustumCulled = false; LEASH.name = 'npcLeashes'; scene.add(LEASH);
// "needs a ride" markers: a bobbing yellow hand-up diamond above people hailing (seen from far, so you can find them)
const MK = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.22, 0).scale(.8, 1.3, .8), new THREE.MeshBasicMaterial({ color: 0xffd23f }), 8); MK.name = 'npcHail'; MK.frustumCulled = false; MK.count = 1; MK.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0)); scene.add(MK);
const dest = beacon(0xff9f1c, D.ride.stopR); // the drop-off

const pose = new Float32Array(8), dpose = new Float32Array(8), hand = [0, 0, 0], m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
const say2 = (t, ms) => { if (!ctx.GAR && !ctx.OPT) say(t, ms); };
const line = (k, a, dest) => { const L = D.lines[k] || []; return (L[(Math.random() * L.length) | 0] || '').replace('{dest}', dest || ''); };
// rides given (this phone only)
const ST = (() => { try { return JSON.parse(localStorage.getItem('cpm.npc') || '{}'); } catch (e) { return {}; } })();
const saveST = () => { try { localStorage.setItem('cpm.npc', JSON.stringify(ST)); } catch (e) { } };

const seatKind = () => ctx.spec && (ctx.spec.sc ? 'trike' : ctx.spec.pil ? 'pillion' : '');
function busyWhy() {
  if (!seatKind()) return "This bike has no seat for a passenger";
  if (MI.q) return 'Finish your job first'; if (ctx.racing) return 'Not during a race';
  if (ctx.paxBusy && ctx.paxBusy(seatKind())) return 'Your seat is taken';
  return '';
}
function onEvent(e) {
  const a = e.a, nm = a ? a.name : '';
  switch (e.k) {
    case 'hail': say2(`🙋 ${nm}: "${line('hail')}" Stop next to them to give a ride`, 3200); blip('click'); break;
    case 'busy': say2(e.why, 1800); break;
    case 'board': {
      const d = e.door; say2(`${nm}: "${line('board', a, d.n)}" Drop-off marked on the map`, 3600); blip('ok');
      dest.position.set(d.x, H(d.x, d.z), d.z); dest.visible = true; setWaypoint(d.x, d.z, 'Drop-off: ' + (d.l || d.n)); break;
    }
    case 'arrive': ST.rides = (ST.rides | 0) + 1; ST.fare = (ST.fare | 0) + e.fare; saveST(); earn(e.fare); // the fare goes in your wallet (shop.js) say2(`${nm}: "${line('arrive')}" +₱${e.fare} · ${ST.rides} ride${ST.rides > 1 ? 's' : ''}, ₱${ST.fare} total`, 3600); blip('ok'); endRide(); break;
    case 'thrown': say2(`${nm}: "${line('thrown')}"`, 2400); blip('thud', 3); endRide(); break;
    case 'left': say2(`${nm}: "${line('left')}"`, 2200); endRide(); break;
    case 'bump': say2(`${nm}: "${line('bump')}"`, 1300); blip('thud', 2); break;
  }
}
function endRide() { dest.visible = false; if (WP.on && WP.n.startsWith('Drop-off')) clearWaypoint(); }

export function npcFrame(dt, now) {
  const on = (cfg.npc ?? 'auto') !== 'off' && !ctx.GAR && !ctx.inside; // inside a building (places.js) the street is out of sight
  people.mesh.visible = dogs.mesh.visible = SH.visible = LEASH.visible = MK.visible = on;
  const night = lampsOn(), cap = on ? Math.round((D.pool[cfg.gfx] ?? D.pool.med) * (D.density[cfg.npc ?? 'auto'] ?? 1) * (night ? D.night : 1)) : 0;
  const me = F.on ? F : S; camera.getWorldDirection(v3); const cl = Math.hypot(v3.x, v3.z) || 1;
  if (!ctx.paused && !ctx.OPT && !ctx.GAR && !ctx.ride) {
    npcStep(dt, {
      x: me.x, z: me.z, cap, night, cam: { x: camera.position.x, z: camera.position.z, fx: v3.x / cl, fz: v3.z / cl },
      bike: { x: S.x, z: S.z, psi: S.psi, v: S.v || 0, crashed: !!S.crashed, seat: !!seatKind() && !ctx.ride, busy: busyWhy() }, foot: { on: F.on, x: F.x, z: F.z },
    });
    for (const e of NPC.ev) onEvent(e); NPC.ev.length = 0;
  }
  ctx.npcPax = NPC.ride ? 1 : 0; // ride.js: the seat is taken + the passenger's mass
  if (!NPC.ride && dest.visible) endRide();
  draw(now / 1000, on);
}

function draw(t, on) {
  people.clear(); dogs.clear(); let ns = 0, nl = 0, nm = 0;
  if (on) {
    camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
    const far = (Q.fog || 1000) * .5;
    for (const a of NPC.list) {
      const p = poseOf(a); if (!p) { a.vis = false; continue; }
      sph.center.set(a.x, a.y + .9, a.z); sph.radius = 1.4; a.vis = a.dist < far && fr.intersectsSphere(sph); if (!a.vis) continue;
      const P = POSES[p] || POSES.stand, k = a.st === 'hail' ? a.k : p === 'walk' ? Math.min(1, a.spd / 1.3) : (a.id % 7) / 7;
      P(pose, t + a.id * 1.7, k, a.ph); const drop = p === 'squat' || p === 'sit' || p === 'dazed' ? footDrop(pose) * a.sy : p === 'walk' || p === 'run' ? -.025 * Math.abs(Math.sin(a.ph)) * k : 0;
      people.push(a.x, a.y, a.z, a.psi, a.sx, a.sy, a.mask, pose, a.pal, drop + a.sink);
      shadow(ns++, a.x, a.y, a.z, .55 * a.sx, a.sink > .6 ? 0 : 1);
      if (a.st === 'hail' && nm < 8) { MK.setMatrixAt(nm++, m4.compose(v3.set(a.x, a.y + 2.25 * a.sy + Math.sin(t * 3 + a.id) * .08, a.z), q4.setFromAxisAngle(s3.set(0, 1, 0), t * 2), s3.set(1, 1, 1))); }
      const g = a.dog; if (!g) continue;
      const gp = g.st === 'walk' ? POSES.dogWalk : g.st === 'sniff' ? POSES.dogSniff : g.st === 'sit' ? POSES.dogSit : POSES.dogStand;
      gp(dpose, t + a.id, Math.min(1, g.spd / 1.2), g.ph); dogs.push(g.x, g.y, g.z, g.psi, g.sc, g.sc, 0, dpose, g.pal, dogDrop(dpose) * g.sc + a.sink * .5);
      shadow(ns++, g.x, g.y, g.z, .45 * g.sc, a.sink > .6 ? 0 : 1);
      // leash: the owner's left hand to the collar
      handAt(pose, -1, DIMS, hand); const c = Math.cos(a.psi), s = Math.sin(a.psi), hx = hand[0] * a.sx, hz = hand[2] * a.sy, hy = hand[1] * a.sy - drop - a.sink;
      const gx = g.x - Math.sin(g.psi) * .24 * g.sc, gz = g.z - Math.cos(g.psi) * .24 * g.sc;
      leP.array.set([a.x + hx * c + hz * s, a.y + hy, a.z - hx * s + hz * c, gx, g.y + .5 * g.sc - dogDrop(dpose) * g.sc, gz], nl * 6); nl++;
    }
  }
  people.commit(); dogs.commit();
  if (!ns) shadow(ns++, 0, -1e4, 0, 0, 0); SH.count = ns; SH.instanceMatrix.needsUpdate = true; shK.needsUpdate = true;
  LE.setDrawRange(0, Math.max(2, nl * 2)); if (!nl) leP.array.fill(0, 0, 6); leP.needsUpdate = true;
  if (!nm) MK.setMatrixAt(nm++, m4.makeScale(0, 0, 0)); MK.count = nm; MK.instanceMatrix.needsUpdate = true;
  passenger(t);
}
function shadow(i, x, y, z, r, k) { SH.setMatrixAt(i, m4.makeScale(r * 2, 1, r * 2).setPosition(x, y + .03, z)); shK.array[i] = k; }

// the passenger, sitting on your pillion seat (or in the sidecar) in the body frame of the bike
const SEAT_TRIKE = [1.18, .57, .34]; // ride.js SEATS[1] (x, bench top, z) in the bike's ct frame
function passenger(t) {
  const R = NPC.ride; pax.clear();
  if (R && !ctx.GAR && B.G) {
    const a = R.a, k = seatKind(); POSES[k === 'trike' ? 'seat' : 'pillion'](pose, t, 0, 0);
    if (k === 'trike') pax.push(SEAT_TRIKE[0], SEAT_TRIKE[1] - .6 - J.hipY * a.sy + .04, SEAT_TRIKE[2], 0, a.sx, a.sy, a.base, pose, a.pal);
    else if (B.G.pil && B.G.pil.hip) { const p = B.G.pil; pax.push(0, -.6 + p.dy + p.hip[0] - J.hipY * a.sy + .02, p.dz + p.hip[1], 0, a.sx * .95, a.sy, a.base, pose, a.pal); }
  }
  pax.mesh.visible = pax.n > 0; pax.commit();
}
