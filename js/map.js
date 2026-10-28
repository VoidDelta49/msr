// Full-screen map + waypoint. Tap the minimap (or press M): the game pauses and the map opens out of the minimap's circle, turns north-up and
// eases out to a wider view. Drag to pan (it coasts), pinch / wheel to zoom, tap to drop a pin (it snaps to quest pins, gas stations and named
// places), SET WAYPOINT to ride to it. The waypoint is a violet beacon in the world, a pin or rim arrow plus the distance on the minimap
// (hud.js reads ctx.WP), and it clears itself when you arrive or with CLEAR. Esc / M / the X button close it back into the minimap.
import { $, PI, clamp } from './util.js';
import { ctx } from './state.js';
import { at } from './foot.js';
import { say } from './hud.js';
import { blip } from './audio.js';
import { beacon } from './missions.js';
import { H, SEA, ROADS, MAPV, MAPT, mapHi } from './world.js';

/* ---------- waypoint ---------- */
export const WP = ctx.WP = { on: false, x: 0, z: 0, n: '' };
ctx.wpK = ''; // changes with the waypoint so the minimap redraws
const wpB = beacon(0xa78bfa, 8);
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { } };
export function setWaypoint(x, z, n) {
  WP.on = true; WP.x = x; WP.z = z; WP.n = n || 'Waypoint'; wpB.position.set(x, H(x, z), z); wpB.visible = true; ctx.wpK = 'w' + (x | 0) + ',' + (z | 0);
}
export function clearWaypoint() { WP.on = false; wpB.visible = false; ctx.wpK = ''; }
export function wpTick() { // arrival check (the game loop, while riding or walking)
  if (!WP.on) return; const P = at();
  if (Math.hypot(P.x - WP.x, P.z - WP.z) < 14) { clearWaypoint(); say('You have arrived', 2400); blip('ok'); buzz(40); }
}
export function wpAnim(now) { if (WP.on) { const k = 1 + Math.sin(now * 3) * .06; wpB.scale.set(k, 1, k); } }
const dist = (x, z) => { const P = at(); return Math.hypot(P.x - x, P.z - z); };
const fmt = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
const eta = m => { const s = m / 11; return s < 60 ? Math.max(5, Math.round(s / 5) * 5) + ' s' : Math.round(s / 60) + ' min'; }; // straight line at ~40 km/h
const QNAME = { P: 'Parking challenge', B: 'Parcel delivery', F: 'Food delivery' };

/* ---------- view ---------- */
const el = $('bigmap'), cv = $('bmc'), g = cv.getContext('2d'), mini = $('mini'), card = $('bmCard'), hint = $('bmHint');
const V = { x: 0, z: 0, s: .4, r: 0 }, T = { x: 0, z: 0, s: .4, r: 0 }; // V = what is drawn, T = where it is heading (eased)
let anim = 0, raf = 0, last = 0, tmr = 0, W = 0, HH = 0, dpr = 1, S0 = .2, sMin = .1, sMax = 1.2, sDef = .5, pend = null, bad = null, touched = false, roads = null, cmp = { x: 0, y: 0 }, scl = { x: 0, y: 0 };
const reduce = matchMedia('(prefers-reduced-motion: reduce)'), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const scr2w = (v, sx, sy) => { const c = Math.cos(v.r), n = Math.sin(v.r), dx = sx - W / 2, dy = sy - HH / 2; return { x: v.x + (dx * c + dy * n) / v.s, z: v.z + (-dx * n + dy * c) / v.s }; };
let PX = 0, PY = 0; // proj(): world -> screen, result in PX / PY
function proj(x, z) { const c = Math.cos(V.r), n = Math.sin(V.r), dx = (x - V.x) * V.s, dz = (z - V.z) * V.s; PX = W / 2 + dx * c - dz * n; PY = HH / 2 + dx * n + dz * c; }
function clampView(v) { const hw = MAPV.w / 2 * .92; v.x = clamp(v.x, MAPV.cx - hw, MAPV.cx + hw); v.z = clamp(v.z, MAPV.cz - hw, MAPV.cz + hw); v.s = clamp(v.s, sMin, sMax); }
function zoomAt(v, sx, sy, f) { const a = scr2w(v, sx, sy); v.s = clamp(v.s * f, sMin, sMax); const b = scr2w(v, sx, sy); v.x += a.x - b.x; v.z += a.z - b.z; } // the point under the finger stays put
function size() {
  W = innerWidth; HH = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(HH * dpr);
  sMin = Math.min(W, HH) / (MAPV.w * .9); sDef = clamp(Math.min(W, HH) / 900, sMin, .9); sMax = Math.max(1.2, sDef);
  const a = $('bmMe').getBoundingClientRect(), b = $('bmX').getBoundingClientRect(); cmp = { x: a.left + a.width / 2, y: a.bottom + 24 }; scl = { x: b.right + 14, y: b.top + b.height / 2 };
}
function buildRoads() {
  const P = { minor: new Path2D(), hwy: new Path2D(), strip: new Path2D() };
  for (const r of ROADS) { const p = r.kind === 'strip' ? P.strip : r.hwy ? P.hwy : P.minor, n = r.s.length; for (let i = 0; i < n; i += 3) { const q = r.s[i]; i ? p.lineTo(q.x, q.z) : p.moveTo(q.x, q.z); } const e = r.s[n - 1]; p.lineTo(e.x, e.z); }
  roads = [[P.minor, 5.5, '#f1ede2'], [P.hwy, 8.5, '#fffdf5'], [P.strip, 13, '#dcd8cc']];
}

/* ---------- open / close ---------- */
const circ = (r, m) => `circle(${r}px at ${m.left + m.width / 2}px ${m.top + m.height / 2}px)`;
export function openMap() {
  if (anim || ctx.paused || ctx.GAR || ctx.OPT || ctx.MENU) return;
  if (ctx.racing) return say('Not during a race');
  const m = mini.getBoundingClientRect(); if (m.width < 8) return;
  ctx.paused = true; ctx.mapOpen = true; anim = 1; el.hidden = false; size(); if (!roads) buildRoads();
  const P = at(); S0 = m.width / 140 * 2.6 * MAPV.n / MAPV.w; // start exactly where the minimap is: on you, heading up, same scale
  Object.assign(V, { x: P.x, z: P.z, s: S0, r: wrap(P.psi) }); Object.assign(T, { x: P.x, z: P.z, s: sDef, r: 0 }); clampView(T);
  pend = null; bad = null; showCard(); hint.classList.toggle('on', !WP.on && !touched);
  const R = Math.hypot(Math.max(m.left + m.width / 2, W - m.left - m.width / 2), Math.max(m.top + m.height / 2, HH - m.top - m.height / 2)), q = reduce.matches;
  el.style.transition = 'none'; el.style.clipPath = circ(m.width * .5, m); void el.offsetWidth;
  el.style.transition = q ? 'none' : 'clip-path .48s cubic-bezier(.2,.85,.25,1)'; el.style.clipPath = circ(R, m);
  clearTimeout(tmr); tmr = setTimeout(() => { anim = 2; el.style.clipPath = ''; el.style.transition = ''; ctx.mapCover = true; }, q ? 0 : 500);
  cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame);
}
export function closeMap() {
  if (anim === 0 || anim === 3) return;
  anim = 3; ctx.mapCover = false; ctx.paused = false; pend = null; card.classList.remove('on'); hint.classList.remove('on'); // the game runs again while the map folds back
  const m = mini.getBoundingClientRect(), q = reduce.matches;
  el.style.transition = 'none'; el.style.clipPath = circ(Math.hypot(W, HH), m); void el.offsetWidth;
  el.style.transition = q ? 'none' : 'clip-path .4s cubic-bezier(.55,.05,.75,.3)'; el.style.clipPath = circ(m.width * .5, m);
  clearTimeout(tmr); tmr = setTimeout(() => { anim = 0; el.hidden = true; el.style.clipPath = ''; el.style.transition = ''; ctx.mapOpen = false; cancelAnimationFrame(raf); }, q ? 0 : 420);
}
mini.addEventListener('click', openMap);
$('bmX').onclick = () => closeMap();
$('bmMe').onclick = () => { const P = at(); T.x = P.x; T.z = P.z; T.s = sDef; clampView(T); buzz(8); };
addEventListener('resize', () => { if (anim) { size(); clampView(T); clampView(V); } });
addEventListener('keydown', e => { // capture phase: while the map is open it owns the keyboard (no garage / menu behind it)
  if (e.target && e.target.type === 'text') return;
  if (ctx.mapOpen) { if (e.code === 'Escape' || e.code === 'KeyM') closeMap(); if (e.code !== 'F5' && !e.ctrlKey && !e.metaKey) { e.stopImmediatePropagation(); e.preventDefault(); } }
  else if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.stopImmediatePropagation(); openMap(); }
}, true);

/* ---------- pins + card ---------- */
function showCard() {
  const set = $('bmSet'), clr = $('bmClr'); let t = '', d = '';
  if (pend) { t = pend.n; d = fmt(dist(pend.x, pend.z)) + ' · about ' + eta(dist(pend.x, pend.z)); }
  else if (WP.on) { t = WP.n; d = fmt(dist(WP.x, WP.z)) + ' away · waypoint set'; }
  set.hidden = !pend; clr.hidden = !WP.on; card.classList.toggle('on', !!(pend || WP.on)); card.classList.remove('bad');
  if (t) { $('bmT').textContent = t; $('bmD').textContent = d; }
  hint.classList.toggle('on', !pend && !WP.on && !touched);
}
$('bmSet').onclick = () => {
  if (!pend) return; const p = pend; setWaypoint(p.x, p.z, p.n); blip('ok'); buzz(18); closeMap(); say('Waypoint set · ' + fmt(dist(p.x, p.z)), 2200);
};
$('bmClr').onclick = () => { clearWaypoint(); buzz(10); showCard(); };
function tap(sx, sy) {
  touched = true; const w = scr2w(V, sx, sy); let x = w.x, z = w.z, name = 'Dropped pin', best = 28, on = false;
  const cand = (cx, cz, n, rad, isWp) => { proj(cx, cz); const d = Math.hypot(PX - sx, PY - sy); if (d < Math.min(best, rad)) { best = d; x = cx; z = cz; name = n; on = !!isWp; } };
  for (const l of MAPV.lab) if (labOn(l)) cand(l.x, l.z, l.n, 34);
  for (const [gx, gz] of MAPV.gas || []) cand(gx, gz, 'Gas station', 24);
  for (const p of (ctx.MI && ctx.MI.pins) || []) cand(p.x, p.z, QNAME[p.g] || 'Quest', 28);
  if (WP.on) cand(WP.x, WP.z, WP.n, 30, true);
  if (on) { pend = null; showCard(); buzz(8); return; } // tapped the waypoint itself: just show it
  if (H(x, z) < SEA + .25) { // sea: no pin
    bad = { x: sx, y: sy, t: performance.now() }; pend = null; card.classList.add('on', 'bad'); $('bmT').textContent = 'Open water'; $('bmD').textContent = 'Pick a spot on land'; $('bmSet').hidden = true; $('bmClr').hidden = true; hint.classList.remove('on');
    clearTimeout(tap.t); tap.t = setTimeout(() => { if (anim === 2 || anim === 1) showCard(); }, 1500); buzz([12, 40, 12]); return;
  }
  pend = { x, z, n: name, t: performance.now() }; showCard(); buzz(10);
}
const labOn = l => l.p === 2 || (l.p === 1 && V.s > .2) || (l.p === 0 && V.s > .5);

/* ---------- gestures ---------- */
const ptrs = new Map(); let tapOk = false, t0 = 0, sx0 = 0, sy0 = 0, pinD = 0, pcx = 0, pcy = 0, vx = 0, vz = 0, lm = 0;
const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
cv.addEventListener('pointerdown', e => {
  if (anim === 3) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); Object.assign(T, V); cv.classList.add('drag');
  if (ptrs.size === 1) { tapOk = true; t0 = e.timeStamp; sx0 = e.clientX; sy0 = e.clientY; vx = vz = 0; lm = e.timeStamp; } else { tapOk = false; const q = two(); pinD = q.d; pcx = q.x; pcy = q.y; }
});
cv.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  const c = Math.cos(V.r), n = Math.sin(V.r);
  if (tapOk && Math.hypot(e.clientX - sx0, e.clientY - sy0) > 9) tapOk = false;
  if (ptrs.size === 1) {
    const wx = (dx * c + dy * n) / V.s, wz = (-dx * n + dy * c) / V.s; V.x -= wx; V.z -= wz;
    const dt = Math.max(1, e.timeStamp - lm); lm = e.timeStamp; vx += (wx / dt * 1000 - vx) * .4; vz += (wz / dt * 1000 - vz) * .4;
  } else if (ptrs.size === 2) {
    const q = two(), ddx = q.x - pcx, ddy = q.y - pcy; V.x -= (ddx * c + ddy * n) / V.s; V.z -= (-ddx * n + ddy * c) / V.s;
    if (pinD > 0 && q.d > 0) zoomAt(V, q.x, q.y, q.d / pinD); pinD = q.d; pcx = q.x; pcy = q.y; vx = vz = 0;
  }
  clampView(V); Object.assign(T, V);
});
const up = e => {
  if (!ptrs.delete(e.pointerId)) return;
  if (ptrs.size === 0) {
    cv.classList.remove('drag');
    if (e.type === 'pointerup' && tapOk && e.timeStamp - t0 < 450 && anim !== 3) tap(e.clientX, e.clientY);
    else if (e.type === 'pointerup' && e.timeStamp - lm < 90) { T.x = V.x - vx * .32; T.z = V.z - vz * .32; clampView(T); } // flick: coast on
    else Object.assign(T, V);
  } else if (ptrs.size === 1) { const q = [...ptrs.values()][0]; tapOk = false; sx0 = q.x; sy0 = q.y; vx = vz = 0; Object.assign(T, V); }
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', e => { e.preventDefault(); touched = true; zoomAt(T, e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0016))); clampView(T); }, { passive: false });

/* ---------- frame ---------- */
function frame(t) {
  if (!anim) return; raf = requestAnimationFrame(frame);
  const dt = Math.min(.05, (t - last) / 1000); last = t; const P = at();
  if (anim === 3) { T.x = P.x; T.z = P.z; T.s = S0; T.r = V.r + wrap(P.psi - V.r); } // closing: back to the minimap's own view
  const k = 1 - Math.exp(-dt * (anim === 3 ? 7 : 7.5));
  if (!ptrs.size || anim === 3) { V.x += (T.x - V.x) * k; V.z += (T.z - V.z) * k; V.s *= Math.pow(T.s / V.s, k); V.r += wrap(T.r - V.r) * k; }
  if (!mapHi.done && anim !== 3) mapHi.step(anim === 1 ? 3 : 6);
  draw(t);
}
function pin(x, y, col, sc) { // teardrop with its tip at (x, y)
  const r = 10 * sc; g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(0, 0, r * .8, r * .32, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-r * .3, -r, -r, -r * 1.3, -r, -r * 2.1); g.arc(0, -r * 2.1, r, PI, 0); g.bezierCurveTo(r, -r * 1.3, r * .3, -r, 0, 0); g.closePath();
  g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(0, -r * 2.1, r * .38, 0, 7); g.fill(); g.restore();
}
// the terrain + roads only change when the view moves: they are drawn into a cached layer and just blitted while the map sits still
let layer = null, lg = null, lk = '';
function world(now) {
  const hi = mapHi.done ? clamp((now - mapHi.t) / 450, 0, 1) : -1, key = [V.x.toFixed(2), V.z.toFixed(2), V.s.toFixed(5), V.r.toFixed(4), cv.width, cv.height, hi.toFixed(2)].join();
  if (key !== lk) {
    lk = key; if (!layer || layer.width !== cv.width || layer.height !== cv.height) { layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height; lg = layer.getContext('2d'); }
    const c = lg, s = V.s, u = 1 / s; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#1f7896'; c.fillRect(0, 0, W, HH);
    c.save(); c.translate(W / 2, HH / 2); c.rotate(V.r); c.scale(s, s); c.translate(-V.x, -V.z);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; const x0 = MAPV.cx - MAPV.w / 2, z0 = MAPV.cz - MAPV.w / 2;
    c.drawImage(MAPT, x0, z0, MAPV.w, MAPV.w);
    if (hi > 0) { c.globalAlpha = hi; c.drawImage(mapHi.cv, x0, z0, MAPV.w, MAPV.w); c.globalAlpha = 1; }
    c.lineCap = c.lineJoin = 'round';
    for (const [path, w, col] of roads) { const lw = Math.max(w, 2.6 * u); c.strokeStyle = 'rgba(40,34,28,.4)'; c.lineWidth = lw + 1.8 * u; c.stroke(path); c.strokeStyle = col; c.lineWidth = lw; c.stroke(path); }
    c.restore();
  }
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(layer, 0, 0); g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function draw(now) {
  const P = at(), s = V.s;
  world(now);
  const on = (x, y, m) => x > -m && y > -m && x < W + m && y < HH + m;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  for (const l of MAPV.lab) { // place names
    if (!labOn(l)) continue; proj(l.x, l.z); if (!on(PX, PY, 40)) continue;
    g.font = `700 ${l.p === 2 ? 13 : 11}px system-ui`; g.lineWidth = 3.5; g.strokeStyle = 'rgba(8,26,36,.72)'; g.strokeText(l.n, PX, PY); g.fillStyle = '#fff'; g.fillText(l.n, PX, PY);
  }
  for (const [gx, gz] of MAPV.gas || []) { proj(gx, gz); if (!on(PX, PY, 12)) continue; g.fillStyle = '#ff4a3d'; g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.beginPath(); g.arc(PX, PY, 6, 0, 7); g.fill(); g.stroke(); }
  g.font = '700 10px system-ui';
  for (const p of (ctx.MI && ctx.MI.pins) || []) { // quest pins
    proj(p.x, p.z); if (!on(PX, PY, 16)) continue; g.fillStyle = p.c; g.strokeStyle = p.h ? '#ff4a3d' : '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(PX, PY, 10, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#fff'; if (p.g) g.fillText(p.g, PX, PY + .5); else { g.beginPath(); g.arc(PX, PY, 3, 0, 7); g.fill(); }
  }
  for (const p of ctx.mpDots || []) { proj(p.x, p.z); if (!on(PX, PY, 10)) continue; g.fillStyle = '#3ad7ff'; g.strokeStyle = '#0b1a22'; g.lineWidth = 1.5; g.beginPath(); g.arc(PX, PY, 5, 0, 7); g.fill(); g.stroke(); }
  proj(P.x, P.z); const mx = PX, my = PY;
  if (WP.on) { // route line + the waypoint
    proj(WP.x, WP.z); g.save(); g.setLineDash([9, 8]); g.lineDashOffset = -now * .03; g.strokeStyle = 'rgba(167,139,250,.95)'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(mx, my); g.lineTo(PX, PY); g.stroke(); g.restore();
    const pu = (now % 1600) / 1600; g.strokeStyle = `rgba(167,139,250,${.7 * (1 - pu)})`; g.lineWidth = 3; g.beginPath(); g.arc(PX, PY, 8 + 22 * pu, 0, 7); g.stroke(); pin(PX, PY, '#a78bfa', 1.1);
  }
  if (pend) { // the pin being placed: drops in with a little overshoot, then a ripple
    proj(pend.x, pend.z); const d = now - pend.t, k = clamp(d / 380, 0, 1), eb = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2); // easeOutBack
    if (d > 300) { const rt = clamp((d - 300) / 700, 0, 1); g.strokeStyle = `rgba(255,255,255,${.85 * (1 - rt)})`; g.lineWidth = 3; g.beginPath(); g.arc(PX, PY, 6 + 30 * rt, 0, 7); g.stroke(); }
    pin(PX, PY - (1 - eb) * 60, '#a78bfa', 1.25);
  }
  if (bad) { const d = (now - bad.t) / 700; if (d < 1) { g.strokeStyle = `rgba(255,74,61,${1 - d})`; g.lineWidth = 3; g.beginPath(); g.arc(bad.x, bad.y, 8 + 22 * d, 0, 7); g.stroke(); g.beginPath(); g.moveTo(bad.x - 7, bad.y - 7); g.lineTo(bad.x + 7, bad.y + 7); g.moveTo(bad.x + 7, bad.y - 7); g.lineTo(bad.x - 7, bad.y + 7); g.stroke(); } else bad = null; }
  // you
  g.save(); g.translate(mx, my); const pl = (now % 2000) / 2000; g.fillStyle = `rgba(255,176,32,${.28 * (1 - pl)})`; g.beginPath(); g.arc(0, 0, 10 + 16 * pl, 0, 7); g.fill();
  g.rotate(V.r - P.psi); g.fillStyle = '#ffb020'; g.strokeStyle = '#1a1000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
  // compass + scale bar
  g.save(); g.translate(cmp.x, cmp.y); g.fillStyle = 'rgba(10,12,16,.6)'; g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 1.5; g.beginPath(); g.arc(0, 0, 15, 0, 7); g.fill(); g.stroke();
  g.rotate(V.r); g.fillStyle = '#ff4a3d'; g.beginPath(); g.moveTo(0, -11); g.lineTo(4.5, 1); g.lineTo(-4.5, 1); g.closePath(); g.fill(); g.fillStyle = '#e8ecef'; g.beginPath(); g.moveTo(0, 11); g.lineTo(4.5, 1); g.lineTo(-4.5, 1); g.closePath(); g.fill(); g.restore();
  let L = 10; for (const c of [20, 50, 100, 200, 500, 1000, 2000]) if (c * s <= 120) L = c; const bw = L * s;
  g.fillStyle = 'rgba(10,12,16,.6)'; g.fillRect(scl.x - 6, scl.y - 15, bw + 12, 30); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(scl.x, scl.y - 3); g.lineTo(scl.x, scl.y + 4); g.lineTo(scl.x + bw, scl.y + 4); g.lineTo(scl.x + bw, scl.y - 3); g.stroke();
  g.font = '700 11px system-ui'; g.textAlign = 'left'; g.fillStyle = '#fff'; g.fillText(L >= 1000 ? L / 1000 + ' km' : L + ' m', scl.x, scl.y - 7); g.textAlign = 'center';
}
ctx.mapApi = { open: openMap, close: closeMap, tap, V, T, WP, setWaypoint, clearWaypoint }; // test hook (window.__cpm.ctx.mapApi)
