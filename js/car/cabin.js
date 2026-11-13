// The inside of a van as data (data/cars/<id>.json `cabin`): floor, walls, the door gap, and SLOTS that each take one fit-out
// ITEM (seat rows today; a camper's bed / kitchen / cupboards later = new items + a drawing case in carfig/fitout.js, no logic change).
// Headless (no three / DOM): drive.js uses it to let the walker in, the model draws the items, and the cargo check says if a bike fits.
// Frame: the car's (+z forward, +x LEFT, +y up, y = 0 the ground at ride height).

// fit = { slotId: itemId | '' } -> the item in every slot ('' = empty floor). A missing / unknown entry = the slot's first option (stock).
export function fitOf(cab, saved) {
  const out = {}; for (const s of cab.slots) { const v = saved && saved[s.id]; out[s.id] = v != null && s.fit.includes(v) ? v : s.fit[0]; } return out;
}
// an item's footprint in the car frame: [x0, x1, z0, z1]. `box` in the item data is relative to the slot's z; benches derive one
// (the aisle side gives a little: a cushion edge you squeeze past).
export function itemBox(cab, slot, id) {
  const it = cab.items[id]; if (!it) return null;
  if (it.box) return [it.box[0], it.box[1], slot.z + it.box[2], slot.z + it.box[3]];
  return [it.x - it.w / 2 + (it.soft ?? .2), it.x + it.w / 2, slot.z - .3, slot.z + .22];
}
// walls + fitted items as boxes in the car frame { x, z, hx, hz }: the shell with a gap at the sliding door, the cab block in front
export function cabBoxes(cab, fit) {
  const { x: ix, t, tail, nose, door: d } = cab, wx = ix + t / 2, L = [];
  const zb = (x, z0, z1, hx) => L.push({ x, z: (z0 + z1) / 2, hx, hz: (z1 - z0) / 2 });
  zb(-d.side * wx, tail, nose, t / 2);                                      // the solid side
  zb(d.side * wx, tail, d.z[0], t / 2); zb(d.side * wx, d.z[1], nose, t / 2); // the door side, open between d.z
  zb(0, tail, cab.z[0], wx); zb(0, cab.z[1], nose, wx);                      // tailgate, the cab (front seats, engine box, dash)
  for (const s of cab.slots) { const b = itemBox(cab, s, fit[s.id]); if (b) zb((b[0] + b[1]) / 2, b[2], b[3], (b[1] - b[0]) / 2); }
  return L;
}
// floor height (car frame) at a local point, or null outside: the cabin floor, and the step outside the sliding door
export function cabFloor(cab, lx, lz) {
  const d = cab.door, ox = cab.x + cab.t;
  if (Math.abs(lx) <= ox && lz >= cab.tail && lz <= cab.nose) return cab.floor;
  if (lx * d.side > ox && lx * d.side < ox + .32 && lz > d.z[0] && lz < d.z[1]) return d.step;
  return null;
}
export const inCab = (cab, lx, lz) => Math.abs(lx) < cab.x + .05 && lz > cab.z[0] - .05 && lz < cab.z[1] + .05;
// the slot nearest a point inside (for the walker's REMOVE / FIT button), within reach
export function slotNear(cab, lz, reach = 1) {
  let b = null, bd = reach; for (const s of cab.slots) { const d = Math.abs(lz - s.z); if (d < bd) { bd = d; b = s; } } return b;
}
// does a bike of length L, height h fit lengthwise from the tailgate, with the slots as they are? -> '' or why not
export function cargoWhy(cab, fit, L, h) {
  const c = cab.cargo, z0 = cab.z[0] + .04, z1 = z0 + L;
  if (z1 > cab.z[1] - .02) return 'Too long for the van';
  if (h > cab.roof - cab.floor + .25) return 'Too tall for the van'; // mirrors fold in: a little over the headroom still goes
  for (const s of cab.slots) { const b = itemBox(cab, s, fit[s.id]); if (b && b[3] > z0 && b[2] < z1 && b[1] > c.x - c.w / 2 && b[0] < c.x + c.w / 2) return 'Take the seats out first'; }
  return '';
}
// can this slot take that item with a bike aboard (span [z0, z1])?
export function slotFree(cab, slot, id, span) { const b = itemBox(cab, slot, id); return !b || !span || !(b[3] > span[0] && b[2] < span[1]); }
export function cabProblems(cab) {
  const P = [], num = v => typeof v === 'number' && Number.isFinite(v);
  if (!cab) return P;
  for (const k of ['floor', 'roof', 'x', 't', 'tail', 'nose']) if (!num(cab[k])) P.push('cabin.' + k);
  if (!cab.door || !(cab.door.side === 1 || cab.door.side === -1) || !num(cab.door.step)) P.push('cabin.door {side 1|-1, z, step}');
  if (!cab.cargo || !num(cab.cargo.w)) P.push('cabin.cargo {x, w}');
  for (const s of cab.slots || []) for (const id of s.fit) if (id && !cab.items[id]) P.push(`cabin slot ${s.id}: unknown item ${id}`);
  return P;
}
