// data/cars/<id>.json -> the numbers the systems run on (the car twin of spec.js computeSpec). Headless.
// Vehicle frame: origin on the ground under the middle of the wheelbase at ride height, +z forward, +x LEFT, +y up, metres.
// A vehicle is a list of AXLES, so 3 wheels (track 0 = one centre wheel), 4, or a 6-wheel truck are all just data.
const G = 9.81, d2r = Math.PI / 180;
export const GEARBOXES = ['manual', 'auto'];

export function carProblems(c) {
  const P = [], num = (v, lo, hi) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi, need = (ok, m) => { if (!ok) P.push(m); };
  if (!c || typeof c !== 'object') return ['not an object'];
  for (const k of ['id', 'name', 'short', 'class']) need(typeof c[k] === 'string' && c[k], `"${k}" missing`);
  const b = c.body || {}, e = c.engine || {}, g = c.gearbox || {}, s = c.steer || {}, ax = c.axles;
  need(num(b.m, 150, 40000), 'body.m (kg with driver)'); need(Array.isArray(b.size) && b.size.length === 3 && b.size.every(v => num(v, .3, 20)), 'body.size [width, height, length] m');
  need(Array.isArray(b.cg) && b.cg.length === 3 && num(b.cg[1], .1, 3), 'body.cg [x, y, z] m'); need(num(b.clear, .03, 1), 'body.clear (ground clearance m)'); need(num(b.drag, .05, 6), 'body.drag (0.5 x air density x Cd x area)');
  need(num(e.Ie, .005, 5), 'engine.Ie'); need(num(e.idle, 300, 3000), 'engine.idle'); need(num(e.red, 1500, 20000) && e.red > e.idle, 'engine.red');
  need(Array.isArray(e.torque) && e.torque.length > 2 && e.torque.every((p, i) => p.length === 2 && (!i || p[0] > e.torque[i - 1][0])), 'engine.torque [[rpm, Nm], ...] sorted by rpm');
  need(Array.isArray(e.fric) && e.fric.length === 2, 'engine.fric [Nm, Nm per rpm]');
  need(e.geo && num(e.geo.bore, 30, 200) && num(e.geo.stroke, 30, 200) && num(e.geo.cr, 6, 25) && num(e.geo.peak, 1000, 20000), 'engine.geo {bore, stroke, cr, peak}'); need(num(e.cyl, 1, 16), 'engine.cyl');
  need(GEARBOXES.includes(g.type), `gearbox.type (${GEARBOXES.join(' | ')})`); need(Array.isArray(g.gears) && g.gears.length && g.gears.every(v => num(v, .2, 12)), 'gearbox.gears [1st, 2nd, ...]');
  need(num(g.rev, .5, 12), 'gearbox.rev'); need(num(g.final, 1, 12), 'gearbox.final'); need(num(g.eta, .5, 1), 'gearbox.eta'); need(num(g.clutchCap, 10, 5000), 'gearbox.clutchCap Nm');
  need(num(s.lock, 5, 60) && num(s.rate, 20, 1000) && num(s.v, 3, 200), 'steer {lock deg, rate deg/s, v m/s where the lock is halved}');
  if (!Array.isArray(ax) || ax.length < 2) { P.push('axles: at least 2'); return P; }
  ax.forEach((a, i) => {
    const A = `axles[${i}]`, t = a.tyre || {}, u = a.susp || {};
    need(num(a.z, -15, 15), A + '.z'); need(num(a.track, 0, 3), A + '.track (0 = one centre wheel)'); need(num(a.r, .1, .8), A + '.r'); need(num(a.Iw, .05, 60), A + '.Iw');
    need(num(a.brake, 0, 30000), A + '.brake (Nm per wheel)'); need(num(u.hz, .5, 5) && num(u.zeta, .05, 1.5), A + '.susp {hz, zeta}');
    need(Array.isArray(u.travel) && u.travel.length === 2 && u.travel.every(v => num(v, .01, .6)), A + '.susp.travel [bump, droop] m');
    need(num(t.mu, .3, 2.5) && num(t.ap, 2, 20) && num(t.crr, 0, .1), A + '.tyre {mu, ap deg, crr}');
  });
  if (c.model) { // in the game (js/carfig): what the driver, the dash and the sound need
    need(c.fuel && num(c.fuel.cap, 5, 400) && num(c.fuel.bsfc, 150, 400) && num(c.fuel.idle, .1, 5), 'fuel {cap L, bsfc g/kWh, idle L/h}'); need(num(e.tachMax, 2000, 20000), 'engine.tachMax');
    need(c.sound && num(c.sound.cyl, 1, 16) && ['gain', 'pq', 'bq', 'punch', 'rough', 'crackle', 'mech', 'intake', 'bright', 'drive', 'muf', 'hdr'].every(k => num(c.sound[k], 0, 5)), 'sound {cyl, gain, pq, bq, punch, rough, crackle, mech, intake, bright, drive, muf, hdr}');
    need(c.cab && ['eye', 'door'].every(k => Array.isArray(c.cab[k]) && c.cab[k].every(v => num(v, -10, 10))) && num(c.cab.vmax, 60, 400), 'cab {eye [x, y, z], door [x, z], vmax km/h on the dial}'); need(typeof c.hint === 'string', 'hint');
  }
  need(ax.some(a => a.drive > 0), 'no driven axle'); need(ax.some(a => a.steer), 'no steered axle'); need(new Set(ax.map(a => a.z)).size === ax.length, 'two axles at the same z');
  return P;
}

export function carSpec(c) {
  const b = c.body, [cx, cy, cz] = b.cg, [bw, bh, bl] = b.size, ax = c.axles, m = b.m;
  // static axle loads: the body sits on its springs as a plane (exact for 2 axles, least squares for more)
  const n = ax.map(a => a.track > 0 ? 2 : 1); let s0 = 0, s1 = 0, s2 = 0;
  ax.forEach((a, i) => { s0 += n[i]; s1 += n[i] * a.z; s2 += n[i] * a.z * a.z; });
  const det = s0 * s2 - s1 * s1, W = m * G, pa = W * (s2 - s1 * cz) / det, pb = W * (s0 * cz - s1) / det;
  const fixed = ax.filter(a => !a.steer), zref = fixed.length ? fixed.reduce((t, a) => t + a.z, 0) / fixed.length : 0, drv = ax.reduce((t, a) => t + (a.drive || 0), 0);
  const wheels = [];
  ax.forEach((a, i) => {
    const N0 = pa + pb * a.z, mc = N0 / G, k = mc * (2 * Math.PI * a.susp.hz) ** 2, [bump, droop] = a.susp.travel, t = a.tyre;
    for (const side of n[i] === 2 ? [1, -1] : [0]) wheels.push({
      axle: i, side, x: side * a.track / 2 - cx, y: a.r - cy, z: a.z - cz, r: a.r, Iw: a.Iw,
      L: a.steer ? a.z - zref : 0, drive: (a.drive || 0) / drv / n[i], brake: a.brake, hb: a.hb || 0,
      N0, k, c: 2 * a.susp.zeta * Math.sqrt(k * mc), bump, droop, kb: k * 6, arb: n[i] === 2 ? a.susp.arb || 0 : 0,
      mu: t.mu, tap: Math.tan(t.ap * d2r), ls: t.ls ?? .12, crr: t.crr, wetg: t.wetg || 1, aqua: t.aqua || 1,
    });
  });
  const y0 = b.clear - cy, y1 = y0 + bh, box = [];
  for (const x of [-bw / 2 - cx, bw / 2 - cx]) for (const y of [y0, y1]) for (const z of [-bl / 2 + (b.off || 0) - cz, bl / 2 + (b.off || 0) - cz]) box.push([x, y, z]); // body.off: the shell's middle ahead of the wheelbase's (overhangs)
  const e = c.engine, g = c.gearbox;
  return {
    id: c.id, m, cgY: cy, drag: b.drag, wheels, box,
    I: b.I || [m * (bh * bh + bl * bl) / 12, m * (bw * bw + bl * bl) / 12, m * (bw * bw + bh * bh) / 12], // about x (pitch), y (yaw), z (roll)
    peakPS: e.peakPS, ie: e.Ie, idle: e.idle, red: e.red, TQ: e.torque, fric: e.fric, geo: e.geo, cyl: e.cyl,
    auto: g.type === 'auto', gears: g.gears, rev: g.rev, final: g.final, eta: g.eta, cap: g.clutchCap, shiftT: g.shiftT ?? .3, upRpm: g.upRpm || e.geo.peak,
    fuel: c.fuel || null, sound: c.sound || null, tachMax: e.tachMax || e.red,
    lock: c.steer.lock * d2r, rate: c.steer.rate * d2r, steerV: c.steer.v,
  };
}
