// Billiards (nine-ball rack) on a table in an interior. Pure 2-D physics in the table's own frame: x across (width W), z along
// (length L), metres, origin at the table's centre. Balls roll with constant deceleration, collide elastically (equal masses),
// bounce off the cushions, drop into the six pockets. Deterministic, no three.js: tools/interior.mjs runs it headless.
// interiorfig.js draws it and turns a SHOOT into shoot(): the cue ball goes away from where you stand, harder on the break.
export const PC = { L: 2.24, W: 1.12, R: .0286, MU: .42, BANK: .72, RESTI: .94, POCK: .062, SIDE: .058, HZ: 240 };
const RACK = [1, 2, 3, 4, 9, 5, 6, 7, 8]; // the diamond, front to back by row (1 at the apex, 9 in the middle)
export function newTable() { const T = { balls: [], shots: 0, potted: [], scratch: false }; rack(T); return T; }
export function rack(T) {
  const R = PC.R + .0004, dz = R * Math.sqrt(3), fz = -PC.L / 4, rows = [1, 2, 3, 2, 1]; let k = 0;
  T.balls = [{ n: 0, x: 0, z: PC.L / 4, vx: 0, vz: 0, on: true }];
  rows.forEach((c, r) => { for (let i = 0; i < c; i++) T.balls.push({ n: RACK[k++], x: (i - (c - 1) / 2) * 2 * R, z: fz - r * dz, vx: 0, vz: 0, on: true }); });
  T.shots = 0; T.potted = []; T.scratch = false;
}
export const POCKETS = (() => { const w = PC.W / 2, l = PC.L / 2; return [[-w, -l], [w, -l], [-w, 0], [w, 0], [-w, l], [w, l]]; })();
export const moving = T => T.balls.some(b => b.on && (b.vx || b.vz));
export const left = T => T.balls.filter(b => b.on && b.n > 0).length;
// hit the cue ball along (dx, dz) (table frame, any length) at speed v (m/s); false if the balls are still rolling or the cue ball is down
export function shoot(T, dx, dz, v) {
  const c = T.balls[0], L = Math.hypot(dx, dz); if (!c.on || moving(T) || !(L > 1e-6)) return false;
  c.vx = dx / L * v; c.vz = dz / L * v; T.shots++; return true;
}
// advance dt seconds; returns events [{ k: 'pot', n }, { k: 'click', v }, { k: 'bank', v }]
export function poolStep(T, dt, ev = []) {
  const n = Math.max(1, Math.ceil(dt * PC.HZ)), h = dt / n, B = T.balls, R = PC.R, w = PC.W / 2 - R, l = PC.L / 2 - R;
  for (let s = 0; s < n; s++) {
    for (const b of B) {
      if (!b.on) continue; const v = Math.hypot(b.vx, b.vz); if (!v) continue;
      const nv = Math.max(0, v - PC.MU * h); if (nv < .004) { b.vx = b.vz = 0; continue; } b.vx *= nv / v; b.vz *= nv / v;
      b.x += b.vx * h; b.z += b.vz * h;
      for (const [px, pz] of POCKETS) if (Math.hypot(b.x - px, b.z - pz) < (pz === 0 ? PC.SIDE : PC.POCK)) { b.on = false; b.vx = b.vz = 0; ev.push({ k: 'pot', n: b.n }); if (b.n === 0) T.scratch = true; else T.potted.push(b.n); break; }
      if (!b.on) continue;
      if (b.x < -w) { b.x = -w; b.vx = -b.vx * PC.BANK; ev.push({ k: 'bank', v }); } else if (b.x > w) { b.x = w; b.vx = -b.vx * PC.BANK; ev.push({ k: 'bank', v }); }
      if (b.z < -l) { b.z = -l; b.vz = -b.vz * PC.BANK; ev.push({ k: 'bank', v }); } else if (b.z > l) { b.z = l; b.vz = -b.vz * PC.BANK; ev.push({ k: 'bank', v }); }
    }
    for (let i = 0; i < B.length; i++) {
      const a = B[i]; if (!a.on) continue;
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j]; if (!b.on) continue; const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d >= 2 * R || d < 1e-9) continue; const nx = dx / d, nz = dz / d, o = (2 * R - d) / 2;
        a.x -= nx * o; a.z -= nz * o; b.x += nx * o; b.z += nz * o;
        const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz; if (rv <= 0) continue;
        const j2 = rv * (1 + PC.RESTI) / 2; a.vx -= j2 * nx; a.vz -= j2 * nz; b.vx += j2 * nx; b.vz += j2 * nz; ev.push({ k: 'click', v: rv });
      }
    }
  }
  // scratch: once everything has stopped, the cue ball comes back on the head spot (nudged clear of other balls)
  if (T.scratch && !moving(T)) { const c = B[0]; c.on = true; c.x = 0; c.z = PC.L / 4; while (B.some(b => b !== c && b.on && Math.hypot(b.x - c.x, b.z - c.z) < 2 * R)) c.x += 2 * R; T.scratch = false; }
  return ev;
}
