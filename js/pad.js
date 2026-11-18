// Controllers. Any Gamepad API pad (standard mapping: RT throttle, LT brake, LB / right stick down clutch, left stick steers) plus
// Nintendo Joy-Cons through WebHID (Chrome / Edge desktop, Options > Controls > Connect Joy-Cons): hold one in each hand like the
// handlebar grips, twist the right one back for throttle (its accelerometer: the angle from the rest pose, R-stick click re-zeros),
// ZR = front brake lever, ZL = clutch lever (scooters: rear brake), left stick steers, HD rumble plays the engine's firing frequency.
// Buttons become key presses (the game's own keyboard handlers do the rest); analog values land in GP for controls.js / drive.js.
// While a controller is connected the touch controls are hidden (body.touch off). Rumble: padFeel / padEngine, called from haptic.js.
import { cfg } from './config.js';
import { ctx } from './state.js';

export const GP = { on: false, thr: 0, brk: 0, clu: 0, steer: 0, mx: 0, mz: 0, run: false, jc: false, say: null, F: null };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, dz = (v, d = .12) => Math.abs(v) < d ? 0 : Math.sign(v) * (Math.abs(v) - d) / (1 - d);
const N = typeof navigator !== 'undefined' ? navigator : {};

/* ---------- Joy-Cons over WebHID ---------- */
const JC = { L: null, R: null }, RB0 = [0, 1, 0x40, 0x40];
function sub(j, id, args) { const a = new Uint8Array(10 + args.length); a[0] = j.n++ & 15; a.set([...RB0, ...RB0], 1); a[9] = id; a.set(args, 10); return j.d.sendReport(1, a); }
async function jcOpen(d) {
  const side = d.productId === 0x2006 ? 'L' : d.productId === 0x2007 ? 'R' : null; if (!side) return;
  try { if (!d.opened) await d.open(); } catch (e) { return; }
  const j = JC[side] = { d, side, n: 0, b: 0, sx: 0, sy: 0, c: null, g: null, g0: null, k: 0, tw: 0, busy: false };
  d.oninputreport = e => jcIn(j, e);
  try { await sub(j, 0x03, [0x30]); await sub(j, 0x40, [1]); await sub(j, 0x48, [1]); } catch (e) { }
  GP.jc = true; tellPad(side === 'R' ? 'Right Joy-Con: twist it back for throttle, ZR brakes. R-stick click re-zeros the grip' : 'Left Joy-Con: stick steers, ZL is the clutch');
}
function jcIn(j, e) {
  if (e.reportId !== 0x30) return; const v = e.data;
  j.b = v.getUint8(2) | v.getUint8(3) << 8 | v.getUint8(4) << 16; // right byte, shared byte, left byte
  const o = j.side === 'L' ? 5 : 8, b0 = v.getUint8(o), b1 = v.getUint8(o + 1), b2 = v.getUint8(o + 2), x = b0 | (b1 & 15) << 8, y = b1 >> 4 | b2 << 4;
  if (!j.c) j.c = [x, y]; j.sx = dz(clamp((x - j.c[0]) / 1300, -1, 1)); j.sy = dz(clamp((y - j.c[1]) / 1300, -1, 1));
  let ax = 0, ay = 0, az = 0; for (let i = 0; i < 3; i++) { ax += v.getInt16(12 + i * 12, true); ay += v.getInt16(14 + i * 12, true); az += v.getInt16(16 + i * 12, true); }
  const m = Math.hypot(ax, ay, az) || 1, a = [ax / m, ay / m, az / m];
  j.g = j.g ? j.g.map((q, i) => q + (a[i] - q) * .35) : a; j.k++;
  if (!j.g0 && j.k > 12) j.g0 = j.g.slice();
  if (j.g0) {
    const gm = Math.hypot(...j.g), d = clamp((j.g[0] * j.g0[0] + j.g[1] * j.g0[1] + j.g[2] * j.g0[2]) / gm, -1, 1), ang = Math.acos(d);
    j.tw = clamp((ang - .07) / .5, 0, 1); // 4 degrees of free play, wide open at ~33 degrees of twist
    if (ang < .05) j.g0 = j.g0.map((q, i) => q + (j.g[i] / gm - q) * .004); // the resting hand drifts: follow it slowly while closed
  }
}
export async function jcConnect() {
  if (!N.hid) return 'WebHID is not in this browser (Chrome or Edge on a computer)';
  try { const ds = await N.hid.requestDevice({ filters: [{ vendorId: 0x057e }] }); for (const d of ds) await jcOpen(d); } catch (e) { return 'Not connected: ' + e.message; }
  return JC.L || JC.R ? 'Connected: ' + [JC.L && 'L', JC.R && 'R'].filter(Boolean).join(' + ') + (JC.L && JC.R ? '' : '. Tap again for the other one') : 'No Joy-Con picked';
}
if (N.hid) {
  N.hid.getDevices().then(ds => ds.forEach(jcOpen)).catch(() => { });
  N.hid.addEventListener('connect', e => jcOpen(e.device));
  N.hid.addEventListener('disconnect', e => { for (const s in JC) if (JC[s] && JC[s].d === e.device) JC[s] = null; GP.jc = !!(JC.L || JC.R); });
}
// 4 bytes of HD rumble: low / high band frequency (Hz) at one amplitude 0..1 (encoding: dekuNukem's Joy-Con notes)
function hd(lf, hf, amp) {
  if (!(amp > .01)) return RB0;
  const h = (Math.round(32 * Math.log2(clamp(hf, 82, 1252) / 10)) - 0x60) * 4, l = Math.round(32 * Math.log2(clamp(lf, 41, 626) / 10)) - 0x40;
  const a = Math.min(1, amp), e = Math.log2(a * 1000) * 32 - 0x60;
  const ha = clamp(Math.round((a < .117 ? e / (5 - a * a) - 1 : a < .23 ? e - 0x5c : e * 2 - 0xf6) / 2) * 2, 0, 200), q = ha / 2;
  return [h & 255, ha + (h >> 8 & 255), l + (q & 1 ? 0x80 : 0), 0x40 + (q >> 1)];
}
function jcRumble(j, lf, hf, amp) {
  if (!j || j.busy) return; const r = hd(lf, hf, amp), a = new Uint8Array(9); a[0] = j.n++ & 15; a.set(r, 1); a.set(r, 5);
  j.busy = true; j.d.sendReport(0x10, a).catch(() => { }).finally(() => { j.busy = false; });
}

/* ---------- polling: buttons -> keys, sticks / triggers -> GP ---------- */
const BIKE = { a: 'KeyE', rb: 'KeyE', du: 'KeyE', x: 'KeyQ', dd: 'KeyQ', b: 'KeyX', y: 'KeyC', ls: 'KeyR', rs: 'KeyF', dl: 'KeyK', dr: 'KeyT', back: 'KeyN', start: 'Escape' };
const FOOT = { a: 'Space', b: 'KeyE', x: 'KeyF', rs: 'KeyF', y: 'KeyC', back: 'KeyN', start: 'Escape' }; // also while driving a car (F.on stays true there)
const STD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, ls: 10, rs: 11, du: 12, dd: 13, dl: 14, dr: 15 };
// Joy-Con report bits: right byte (0-7), shared (8-15), left (16-23)
const JCB = { a: 3, b: 2, x: 1, y: 0, rb: 6, zr: 7, back: 8, start: 9, rs: 10, ls: 11, key: 12, kill: 13, dd: 16, du: 17, dr: 18, dl: 19, rsr: 4, rsl: 5, lsr: 20, lsl: 21, lb: 22, zl: 23 };
const down = {}; let had = null, last = 0, pads = [], cluR = 0;
const key = (t, code) => dispatchEvent(new KeyboardEvent(t, { code, key: code, bubbles: true }));
function tellPad(m) { if (GP.say) GP.say(m, 3500); }
function poll() {
  const now = performance.now(), dt = Math.min(.1, (now - last) / 1000 || 0); last = now;
  pads = []; let raw = []; try { raw = N.getGamepads ? [...N.getGamepads()] : []; } catch (e) { }
  const hidOn = !!(JC.L || JC.R);
  for (const p of raw) if (p && p.connected && !(hidOn && /joy-con|057e/i.test(p.id))) pads.push(p); // the HID side owns the Joy-Cons
  const on = pads.length > 0 || hidOn;
  if (on !== GP.on) {
    GP.on = on; const B = document.body;
    if (on) { had = B.classList.contains('touch'); B.classList.remove('touch'); tellPad(pads.length && /joy-con/i.test(pads[0].id) && N.hid && !hidOn ? 'Joy-Cons found: Options > Controls > Connect Joy-Cons for the twist throttle' : 'Controller: RT throttle, LT brake, LB clutch, A / X shift'); }
    else if (had) B.classList.add('touch');
  }
  const btn = {}; let thr = 0, brk = 0, clu = 0, sx = 0, sy = 0, rsy = 0, cl = false;
  for (const p of pads) {
    const B = p.buttons, v = i => B[i] ? B[i].value || (B[i].pressed ? 1 : 0) : 0;
    for (const k in STD) if (v(STD[k]) > .5) btn[k] = 1;
    thr = Math.max(thr, v(7)); brk = Math.max(brk, v(6)); if (v(4) > .5) cl = true;
    const A = p.axes; if (Math.abs(A[0] || 0) > Math.abs(sx)) sx = A[0]; if (Math.abs(A[1] || 0) > Math.abs(sy)) sy = A[1]; rsy = Math.max(rsy, A[3] || 0);
  }
  sx = dz(sx); sy = dz(sy);
  for (const s of ['L', 'R']) { const j = JC[s]; if (!j) continue; for (const k in JCB) if (j.b >> JCB[k] & 1) btn[k] = 1; }
  const L = JC.L, R = JC.R;
  if (R) { thr = Math.max(thr, R.tw); if (btn.zr) brk = 1; if (btn.rsr) btn.a = 1; if (btn.rsl) btn.x = 1; if (btn.key) btn.dl = 1; if (btn.kill) btn.dr = 1; if (btn.rs && R.g) { if (!R.rz) { R.g0 = R.g.slice(); tellPad('Throttle zeroed'); } btn.rs = 0; R.rz = 1; } else R.rz = 0; }
  if (L) { if (btn.zl) cl = true; if (btn.lsr) btn.a = 1; if (btn.lsl) btn.x = 1; if (!sx && !sy) { sx = -L.sy; sy = -L.sx; } } // held sideways: the stick's up points left
  else if (R && !sx && !sy) { sx = R.sy; sy = R.sx; }
  cluR = appr(cluR, cl ? 1 : 0, (cl ? 7 : 4) * dt); clu = Math.max(cluR, dz(rsy, .15));
  GP.thr = thr < .02 ? 0 : thr; GP.brk = brk; GP.clu = clu; GP.steer = Math.sign(sx) * Math.abs(sx) ** 1.5;
  GP.mx = sx; GP.mz = -sy; GP.run = !!(btn.lb || btn.zl) || Math.hypot(sx, sy) > .95;
  // edges -> key presses for the current state (menu / options / on foot / on the bike)
  const foot = GP.F && GP.F.on, M = foot ? FOOT : BIKE;
  if ((ctx.MENU || ctx.OPT || ctx.GAR) && btn.b) btn.start = 1;
  if (ctx.MENU && btn.a && !down.a) { const b = document.getElementById('mPlay'); if (b && b.offsetParent) b.click(); }
  for (const k of new Set([...Object.keys(btn), ...Object.keys(down)])) {
    const code = M[k] || (k === 'lb' && foot ? 'ShiftLeft' : null);
    if (btn[k] && !down[k]) { down[k] = code || 1; if (code) key('keydown', code); }
    else if (!btn[k] && down[k]) { if (typeof down[k] === 'string') key('keyup', down[k]); delete down[k]; }
  }
  rumbleTick(now);
  requestAnimationFrame(poll);
}
function appr(a, b, d) { return a < b ? Math.min(b, a + d) : Math.max(b, a - d); }
if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(poll);

/* ---------- rumble ---------- */
// event = [ms, strong (low motor / low band), weak (high motor / high band), Joy-Con low Hz, high Hz]
const FEEL = {
  thud: a => [Math.min(220, 50 + a * 30), Math.min(1, .25 + a * .15), .25, 70, 160],
  crunch: () => [420, 1, 1, 55, 220],
  susp: a => a > .5 ? [70, .5, .15, 90, 180] : 0,
  clank: a => a > .5 ? [60, .35, .3, 120, 400] : 0,
  click: () => [35, 0, .7, 160, 320], // gear change: a crisp tick on the light motor
  splash: () => [150, .3, .4, 80, 300],
  thunder: a => a > .6 ? [650, .7, .3, 45, 100] : 0,
};
let ev = null, evT = 0, eng = { run: false, rpm: 0, load: 0, cyl: 1, cut: false }, rT = 0;
const rOn = () => GP.on && cfg.padRumble !== false;
export function padFeel(type, amt) { const f = FEEL[type], p = f && f(amt); if (!p || !rOn()) return; ev = p; evT = performance.now() + p[0]; send(p[0], p[1], p[2], p[3], p[4], p[1] + p[2] * .5); }
export function padEngine(run, rpm, load, cyl, cut) { eng.run = run; eng.rpm = rpm; eng.load = load; eng.cyl = cyl; eng.cut = cut; }
function send(ms, strong, weak, lf, hf, amp) {
  for (const p of pads) { const v = p.vibrationActuator; if (v && v.playEffect) v.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => { }); }
  jcRumble(JC.R, lf, hf, amp); jcRumble(JC.L, lf, hf, amp * .7);
}
function rumbleTick(now) {
  if (!rOn() || now < evT || now < rT) return;
  if (ev) { ev = null; if (!eng.run) send(20, 0, 0, 0, 0, 0); }
  const e = eng; rT = now + (JC.L || JC.R ? 50 : 90);
  if (!e.run || ctx.MENU) { if (e.was) { send(20, 0, 0, 0, 0, 0); e.was = false; } return; }
  e.was = true; const fire = e.rpm / 120 * e.cyl, r = clamp(e.rpm / 10000, 0, 1), chop = e.cut && (now / 50 | 0) % 2;
  const strong = chop ? .7 : .04 + .3 * e.load * (1 - .5 * r), weak = chop ? .2 : .03 + .25 * r * (.4 + .6 * e.load);
  send(140, strong, weak, fire, fire * 2, chop ? .6 : .1 + .3 * e.load); // the Joy-Con plays the real firing frequency
}
