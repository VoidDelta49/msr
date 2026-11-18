// Model files (data/models/<id>.json), made with the Model Maker (maker/model.html). One format for bikes, cars and props:
//   { id, kind: 'bike' | 'car' | 'prop', frame: {...guides, see FRAME}, parts: [part, ...] }
// part: { n name, t type, s sizes (TYPES), p [x, y, z] m, r [x, y, z] degrees, m material (MATS key or '#rrggbb'),
//         x: 1 = also a mirrored copy at -x, g group (GROUPS), pts [[z, y], ...] (prof: side outline), b [x, y, z] (tube: end point) }
// No imports: Node tools validate with it (tools/mdl.mjs); buildMdl takes THREE from the caller.
export const TYPES = { box: ['w', 'h', 'd'], cyl: ['r top', 'r bottom', 'h', 'sides'], sph: ['r', 'y scale'], prof: ['width', 'bevel'], tube: ['r'], torus: ['R', 'r'] };
export const DEF = { box: [.2, .1, .3], cyl: [.05, .05, .2, 12], sph: [.08, 1], prof: [.2, .01], tube: [.015], torus: [.25, .04] };
// colour, roughness, metalness, emissive: the bike's own materials carry the same names (model.js MATK)
export const MATS = { paint: [0xd23b2a, .36, .2], black: [0x15161a, .34, .3], matte: [0x141518, .6, .2], chrome: [0xd5dae0, .22, 1], alu: [0xb9bec4, .32, .75], metal: [0x2a2c30, .45, .6],
  rubber: [0x0d0d0d, .95, 0], seat: [0x1b1b1b, .85, 0], glass: [0x2c3036, .15, .5], gold: [0xc39a45, .3, .85], light: [0xfff8e0, .2, 0, 0xfff4d0], tail: [0x330000, .4, 0, 0xff1a1a], amber: [0x3a2400, .4, 0, 0xff9a1a] };
// where a part hangs. bike: ct = frame/body, steer = turns with the bars (built straight, in the same bike coordinates), slider = fork
// lowers (move with the front wheel), rear = rear hub (moves with the rear wheel), exh = exhaust. car: body, wheel (one wheel at the
// origin, copied to every axle), steer = steering wheel. prop: one piece.
export const GROUPS = { bike: ['ct', 'steer', 'slider', 'rear', 'exh'], car: ['body', 'wheel', 'steer'], prop: ['body'] };
// guides the maker draws and the game's builders read. bike: front is -z, ct coordinates (y = 0 the ground); rw wheel radius, rearZ rear
// axle, wb wheelbase, rake degrees, head [z, y] top of the steering axis, pivot [z, y] swing-arm pivot, seat [z, y] where the rider sits.
// car: +z forward, +x left; wb, track, r wheel radius.
export const FRAME = { bike: { rw: .29, rearZ: .65, wb: 1.3, rake: 25, head: [-.32, .95], pivot: [.08, .42], seat: [.35, .85] }, car: { wb: 2.6, track: 1.45, r: .33 }, prop: {} };
export const blank = (id, kind = 'bike') => ({ id, kind, frame: { ...FRAME[kind] }, parts: [] });

// each drawn piece: mirrored parts give two (the copy has x, and the y / z rotations, negated; a profile's outline is unchanged)
export function expand(M) {
  const o = [];
  for (const q of M.parts) {
    o.push(q); if (!q.x) continue;
    const p = q.p || [0, 0, 0], r = q.r || [0, 0, 0];
    o.push({ ...q, x: 0, p: [-p[0], p[1], p[2]], r: [r[0], -r[1], -r[2]], b: q.b && [-q.b[0], q.b[1], q.b[2]], mirror: q });
  }
  return o;
}

export function mdlProblems(M) {
  const e = [], num = v => typeof v === 'number' && isFinite(v), v3 = v => Array.isArray(v) && v.length === 3 && v.every(num);
  if (!M || !/^[a-z0-9_-]{1,32}$/.test(M.id || '')) e.push('id: a-z 0-9 _ - only'); if (!GROUPS[M?.kind]) return [...e, `kind must be ${Object.keys(GROUPS).join(' / ')}`];
  if (!Array.isArray(M.parts)) return [...e, 'parts must be a list'];
  M.parts.forEach((q, i) => {
    const w = s => e.push(`part ${i} ${q.n || q.t}: ${s}`), S = TYPES[q.t];
    if (!S) return w(`unknown type ${q.t}`);
    if (!Array.isArray(q.s) || !q.s.length || q.s.length > S.length || !q.s.every(num)) w(`s needs up to ${S.length} numbers (${S.join(', ')})`); else if (q.s.some(v => v < 0)) w('negative size');
    if (q.p && !v3(q.p)) w('p must be [x, y, z]'); if (q.r && !v3(q.r)) w('r must be [x, y, z]');
    if (q.t === 'prof' && !(Array.isArray(q.pts) && q.pts.length >= 3 && q.pts.every(p => p.length === 2 && p.every(num)))) w('pts needs 3+ [z, y] points');
    if (q.t === 'tube' && !v3(q.b)) w('b (end point) must be [x, y, z]');
    if (!(MATS[q.m] || /^#[0-9a-f]{6}$/i.test(q.m || ''))) w(`material ${q.m}: use ${Object.keys(MATS).join(' ')} or #rrggbb`);
    if (!GROUPS[M.kind].includes(q.g || GROUPS[M.kind][0])) w(`group ${q.g}: ${M.kind} groups are ${GROUPS[M.kind].join(' ')}`);
  });
  return e;
}

const D = Math.PI / 180;
export function partGeo(THREE, q) {
  const s = [...DEF[q.t]]; (q.s || []).forEach((v, i) => s[i] = v);
  if (q.t === 'box') return new THREE.BoxGeometry(s[0], s[1], s[2]);
  if (q.t === 'cyl') return new THREE.CylinderGeometry(s[0], s[1], s[2], Math.max(3, s[3] | 0));
  if (q.t === 'sph') return new THREE.SphereGeometry(s[0], 16, 10).scale(1, s[1], 1);
  if (q.t === 'torus') return new THREE.TorusGeometry(s[0], s[1], 8, 24).rotateY(Math.PI / 2); // upright in the side view, like a wheel
  if (q.t === 'tube') { const a = new THREE.Vector3(...(q.p || [0, 0, 0])), d = new THREE.Vector3(...q.b).sub(a); return new THREE.CylinderGeometry(s[0], s[0], d.length(), 8).translate(0, d.length() / 2, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); }
  // prof: the side outline (z, y) extruded s[0] wide, centred on x, edges rounded by s[1]
  const sh = new THREE.Shape(q.pts.map(([z, y]) => new THREE.Vector2(z, y))), b = Math.min(s[1], s[0] / 2 - .001), d = Math.max(.001, s[0] - 2 * b);
  return new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1 }).rotateY(-Math.PI / 2).translate(d / 2, 0, 0);
}
// meshes for every piece, sorted into one THREE.Group per group name: { root, g: { name: Group } }. mat(name) -> material.
export function buildMdl(THREE, M, mat) {
  const root = new THREE.Group(), g = {};
  for (const q of expand(M)) {
    const k = q.g || GROUPS[M.kind][0]; if (!g[k]) { g[k] = new THREE.Group(); g[k].name = k; root.add(g[k]); }
    const o = new THREE.Mesh(partGeo(THREE, q), mat(q.m)), r = q.r || [0, 0, 0];
    o.position.set(...(q.p || [0, 0, 0])); if (q.t !== 'tube') o.rotation.set(r[0] * D, r[1] * D, r[2] * D); // a tube runs p -> b
    o.userData.part = q.mirror || q; o.userData.mir = !!q.mirror; o.castShadow = true; g[k].add(o);
  }
  return { root, g };
}
// the file as saved: one part per line (readable git diffs), numbers to 0.1 mm
export const fmt = M => { const j = v => JSON.stringify(v, (k, x) => typeof x === 'number' ? +x.toFixed(4) : x), { parts, ...h } = M; return j(h).slice(0, -1) + ',"parts":[\n' + parts.map(j).join(',\n') + '\n]}\n'; };
