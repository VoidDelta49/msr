// Parking challenges + refuelling at the gas station
import { $ } from './util.js';
import { S, ctx } from './state.js';
import { freeBays, marker, arrow } from './world.js';
import { say } from './hud.js';
import { blip } from './audio.js';

export const MI = ctx.MI = { on: false };
export function togglePark() { MI.on = !MI.on; $('bPark').classList.toggle('on', MI.on); $('mis').hidden = !MI.on; marker.visible = arrow.visible = MI.on; if (MI.on) newMission(); }
function newMission() {
  const b = freeBays[(Math.random() * freeBays.length) | 0]; Object.assign(MI, { bay: b, t: 0, hold: 0, done: false, h0: S.hits });
  marker.position.set(b.x, .03, b.z); arrow.position.set(b.x, 2.2, b.z); marker.material.color.set(0x43e07a); marker.visible = arrow.visible = true; $('misNext').hidden = true; say('Park in the green bay');
}
$('misNext').onclick = newMission;
export function missions(dt) {
  const cap = ctx.spec.fuel.cap;
  if (Math.abs(S.x + 40) < 6 && Math.abs(S.z - 40) < 3.5 && Math.abs(S.v) < .2 && S.fuel < cap) { S.fuel = Math.min(cap, S.fuel + .5 * dt); say('Refueling... ' + (S.fuel / cap * 100 | 0) + '%', 400); }
  if (!MI.on || MI.done) { if (MI.on) $('misT').textContent = MI.res; return; }
  MI.t += dt; const b = MI.bay, hits = S.hits - MI.h0, ok = Math.abs(S.x - b.x) < .4 && Math.abs(S.z - b.z) < .8 && Math.abs(Math.cos(S.psi)) > .94 && Math.abs(S.v) < .15;
  MI.hold = ok ? MI.hold + dt : 0; marker.material.color.set(ok ? 0xffd23f : 0x43e07a);
  $('misT').textContent = `PARK · ${MI.t.toFixed(1)}s · hits ${hits} · ${Math.hypot(S.x - b.x, S.z - b.z).toFixed(0)}m`;
  if (MI.hold > 1.2) {
    MI.done = true; const st = hits === 0 && MI.t < 40 ? '★★★' : hits <= 1 && MI.t < 70 ? '★★☆' : '★☆☆'; MI.res = `PARKED ${st} · ${MI.t.toFixed(1)}s · hits ${hits}`;
    say('PARKED! ' + st, 2500); blip('ok'); arrow.visible = false; $('misNext').hidden = false;
  }
}
export function animMarker(now) { if (arrow.visible) { arrow.position.y = 2.2 + Math.sin(now * 3) * .25; arrow.rotation.y = now * 2; } }
