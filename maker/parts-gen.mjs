#!/usr/bin/env node
// Garage bolt-ons that every bike gets from one table: tyres (real sizes that fit the rim), rim designs, brake disc + caliper,
// mirrors, levers, grips, seat cover, top box / delivery bag, headlamp bulb, aux lamps, underglow and wheel LEDs.
//   node maker/parts-gen.mjs        writes the parts + their defaults into every data/bikes/<id>.json (re-running replaces them)
// What each key does: tools/README.md "Garage bolt-ons". The drawing is js/model.js (tyre(), wheelFaces(), controls(), fit(),
// applyLook()), the physics keys js/spec.js. A new bike: add a row to BIKES below and run this.
// Text is patched in place (only these parts and their defaults change), so the hand-formatted files stay as they are.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// per bike: mu = stock grip, sz = [stock, sport, skinny, wide, knobby] tyre sizes front · rear (null = not sold for this rim),
// wire = stock wheels are wire-spoked, disc = has a front disc, mir = handlebar mirrors (fairing-mounted ones stay), halo = halogen
// headlamp (an LED conversion shows), box = takes a top box, big = big bike (road tyre range only, existing option names kept)
const BIKES = {
  raider150: { mu: .85, sz: ['70/90-17 · 80/90-17', '80/80-17 · 100/80-17', '60/80-17 · 70/80-17', '90/80-17 · 120/70-17', '70/100-17 · 90/90-17'], disc: 1, mir: 1, box: 1 },
  smash115: { mu: .85, sz: ['70/90-17 · 80/90-17', '70/80-17 · 90/80-17', '50/100-17 · 60/80-17', '80/90-17 · 100/80-17', '70/100-17 · 80/100-17'], wire: 1, mir: 1, halo: 1, box: 1 },
  ns125: { mu: .85, sz: ['80/100-17 · 100/90-17', '90/80-17 · 110/80-17', '60/80-17 · 70/80-17', '100/80-17 · 130/70-17', '80/100-17 · 110/90-17'], disc: 1, mir: 1, halo: 1, box: 1 },
  tmx155: { mu: .85, sz: ['80/100-18 · 90/90-18', '80/90-18 · 100/80-18', '2.25-18 · 2.50-18', '90/90-18 · 110/90-18', '3.00-18 · 3.50-18'], wire: 1, mir: 1, halo: 1, box: 1 },
  macho125: { mu: .85, sz: ['2.75-17 · 3.00-17', '80/90-17 · 90/90-17', '2.25-17 · 2.50-17', '3.00-17 · 110/80-17', '2.75-17 · 3.50-17'], wire: 1, mir: 1, halo: 1, box: 1 },
  click125: { mu: .85, sz: ['80/90-14 · 90/90-14', '90/80-14 · 100/80-14', '60/80-14 · 70/80-14', '100/80-14 · 120/70-14', '90/90-14 · 100/90-14'], disc: 1, mir: 1, box: 1 },
  aerox155: { mu: .85, sz: ['110/80-14 · 140/70-14', '120/70-14 · 140/70-14', '70/80-14 · 80/80-14', '120/70-14 · 150/70-14', '110/80-14 · 130/80-14'], disc: 1, mir: 1, box: 1 },
  nmax155: { mu: .85, sz: ['110/70-13 · 130/70-13', '110/70-13 · 130/70-13', '90/80-13 · 100/80-13', '120/70-13 · 140/70-13', '110/80-13 · 130/80-13'], disc: 1, mir: 1, box: 1 },
  xmax300: { mu: .85, sz: ['120/70-15 · 140/70-14', '120/70-15 · 140/70-14', null, '130/70-15 · 150/70-14', '120/80-15 · 140/80-14'], disc: 1, mir: 1, box: 1 },
  cbr650r: { mu: 1.05, big: ['Stock (Roadsport)', 'Hypersport', 'Track'], sz: ['120/70-17 · 180/55-17'], disc: 1, box: 1 },
  ninjah2: { mu: 1.12, big: ['Stock (hypersport)', 'Track day', 'Slicks'], sz: ['120/70-17 · 200/55-17'], disc: 1 },
};
const r2 = v => Math.round(v * 100) / 100;
// tyT = section height x (low profile = bigger rim showing), tyW = width x, tyK = knobs, tyS = sidewall band colour;
// rollx / dragx = rolling and air drag x, offr = share of the off-road grip loss the tread wins back, dm = kg
function tires(b) {
  const m = b.mu, s = b.sz;
  if (b.big) return [{ n: b.big[0], note: s[0], mu: m }, { n: b.big[1], note: 'Stickier, lower profile', mu: r2(m + .1), tyT: .93, tyW: 1.04, wetg: .9, aqua: .92 },
    { n: b.big[2], note: 'Soft compound, red band', mu: r2(m + .2), tyT: .9, tyW: 1.08, tyS: '#d42a2a', rollx: 1.05, wetg: .6, aqua: .7 }];
  const o = [{ n: 'Stock', note: s[0], mu: m }, { n: 'Sport', note: s[1], mu: r2(m + .15), tyT: .9, tyW: 1.12, dm: .3, wetg: .95, aqua: .93 },
    { n: 'Racing soft', note: 'Wider, red band · wears fast', mu: r2(m + .35), tyT: .86, tyW: 1.22, tyS: '#d42a2a', rollx: 1.06, dm: .5, wetg: .7, aqua: .82 }];
  if (s[2]) o.push({ n: 'Thai concept skinny', note: s[2], mu: r2(m - .15), tyT: .62, tyW: .6, rollx: .78, dragx: .985, dm: -1.8, wetg: 1.12, aqua: 1.3 });
  o.push({ n: 'Wide fat', note: s[3], mu: r2(m + .08), tyT: 1.14, tyW: 1.34, rollx: 1.14, dragx: 1.01, dm: 1.5, wetg: .95, aqua: .75 });
  o.push({ n: 'Dual-sport knobby', note: s[4], mu: r2(m - .07), tyT: 1.1, tyW: 1.1, tyK: 1, offr: .65, rollx: 1.16, dm: .9, wetg: .95, aqua: 1.2 });
  o.push({ n: 'Whitewall classic', note: s[0], mu: m, tyT: 1.04, tyS: '#f1f1ec' });
  return o;
}
const COL = { Gold: '#c9a24a', Red: '#c21d1d', Blue: '#1f4fbf', Purple: '#7a3fd0', Orange: '#e2661a', Lime: '#7bd11f', Titanium: '#8d8f94', Black: '#17181b', White: '#e9e9e4' };
const cols = (key, names, first = 'Stock') => [{ n: first }, ...names.map(n => ({ n, [key]: COL[n] }))];
const LEDS = [['Red', '#ff0a0a'], ['Amber', '#ff7a00'], ['Green', '#10ff30'], ['Cyan', '#00d8ff'], ['Blue', '#1440ff'], ['Purple', '#9a1cff'], ['Pink', '#ff1ea0'], ['White', '#ffffff']];
const leds = key => [{ n: 'Off' }, ...LEDS.map(([n, c]) => ({ n, [key]: c })), { n: 'RGB cycle', note: 'Runs through every colour', [key]: 'rgb' }];
function parts(b) {
  const P = { tires: { l: 'Tires', o: tires(b) } };
  P.rims = { l: 'Rim design', o: [{ n: b.wire ? 'Stock wire spokes' : 'Stock', rimD: 0 }, { n: '6-spoke cast', rimD: 1, dm: b.wire ? -.6 : 0 }, { n: 'Twin 5-spoke', rimD: 2, dm: b.wire ? -1 : -.4 },
    { n: '10-spoke forged', note: 'Lightest', rimD: 3, dm: b.wire ? -1.8 : -1.2 }, { n: '3-spoke', rimD: 4, dm: .3 }, { n: '7 Y-spoke', rimD: 5, dm: b.wire ? -1.2 : -.6 }, ...(b.wire ? [] : [{ n: 'Wire spokes', note: 'Classic laced rim', rimD: 6, dm: .8 }])] };
  if (b.disc) {
    P.disc = { l: 'Brake disc', o: [{ n: 'Stock' }, { n: 'Floating wave disc', dscK: 1, brake: 1.03 }, { n: 'Oversize wave kit', note: 'Bigger disc + bracket', dscK: 2, brake: 1.08, dm: .4 }] };
    P.caliper = { l: 'Caliper colour', o: cols('calC', ['Gold', 'Red', 'Blue', 'Lime', 'Titanium']) };
  }
  if (b.mir) P.mirrors = { l: 'Mirrors', o: [{ n: 'Stock' }, { n: 'Bar-end round', mirK: 1 }, { n: 'Short sport', mirK: 2, dm: -.2 }, { n: 'Removed', note: 'Track look', mirK: 3, dm: -.6 }] };
  P.levers = { l: 'Levers', o: cols('levC', ['Black', 'Gold', 'Red', 'Blue', 'Purple', 'Titanium'], 'Stock') };
  P.grips = { l: 'Grips', o: cols('grpC', ['Red', 'Blue', 'Orange', 'Purple', 'Lime', 'White'], 'Stock black') };
  P.seat = { l: 'Seat cover', o: [{ n: 'Stock black' }, { n: 'Brown leather', seatC: '#6b3f22' }, { n: 'Tan', seatC: '#b08552' }, { n: 'Red', seatC: '#8e1a1f' }, { n: 'Blue', seatC: '#1e3a7a' }, { n: 'White', seatC: '#d9d6cf' }] };
  if (b.box) P.box = { l: 'Top box', o: [{ n: 'None' }, { n: 'Top box 30 L', boxK: 1, dm: 3.4, dragx: 1.02 }, { n: 'Top box 45 L', boxK: 2, dm: 4.6, dragx: 1.04 },
    { n: 'Delivery bag green', boxK: 3, boxC: '#1faa55', dm: 2.8, dragx: 1.07 }, { n: 'Delivery bag pink', boxK: 3, boxC: '#e0317f', dm: 2.8, dragx: 1.07 }] };
  P.hl = { l: 'Headlight bulb', o: [{ n: b.halo ? 'Stock halogen' : 'Stock LED' }, ...(b.halo ? [{ n: 'LED white 6000K', hlC: '#eef4ff' }] : []), { n: 'Yellow 3000K', hlC: '#ffd23a' }, { n: 'Ice blue 8000K', hlC: '#8fc4ff' }] };
  P.aux = { l: 'Auxiliary lights', o: [{ n: 'None' }, { n: 'Mini driving lights', note: 'More light on the road', auxK: 1, dm: .5 }, { n: 'Yellow fog pair', note: 'More light on the road', auxK: 1, auxC: '#ffd23a', dm: .5 }] };
  P.glow = { l: 'Underglow', o: leds('glowC') };
  P.wled = { l: 'Wheel LEDs', o: leds('wledC') };
  return P;
}

// "key": value text patching ------------------------------------------------------------------------------------------------------
const str = v => JSON.stringify(v).replace(/([{,])"(\w+)":/g, '$1"$2": ').replace(/,"/g, ', "').replace(/\},\{/g, '}, {');
function span(t, open) { let d = 0, q = false; for (let i = open; i < t.length; i++) { const c = t[i]; if (q) { if (c === '\\') i++; else if (c === '"') q = false; } else if (c === '"') q = true; else if (c === '{' || c === '[') d++; else if (c === '}' || c === ']') { if (!--d) return i; } } throw new Error('unbalanced'); }
function obj(t, name) { const m = new RegExp(`\\n${/\n( +)"id"/.exec(t)[1]}"${name}": \\{`).exec(t); if (!m) throw new Error('no ' + name); const a = m.index + m[0].length - 1; return [a, span(t, a)]; }
function setIn(t, name, key, text) {
  const [a, b] = obj(t, name), body = t.slice(a, b + 1), m = new RegExp(`"${key}": `).exec(body);
  if (m) { const s = a + m.index + m[0].length, e = /[{[]/.test(t[s]) ? span(t, s) + 1 : s + /^[^,}\n]*/.exec(t.slice(s))[0].length; return t.slice(0, s) + text + t.slice(e); }
  const ind = /\n(\s+)"/.exec(body); let e = b; while (/\s/.test(t[e - 1])) e--;
  return t.slice(0, e) + (ind ? ',\n' + ind[1] : ', ') + `"${key}": ` + text + t.slice(e);
}
let n = 0;
for (const [id, b] of Object.entries(BIKES)) {
  const f = path.join(ROOT, `data/bikes/${id}.json`); let t = readFileSync(f, 'utf8'); const was = JSON.parse(t);
  for (const [k, p] of Object.entries(parts(b))) { t = setIn(t, 'parts', k, str(p)); if (!(k in was.defaults) || was.defaults[k] >= p.o.length) t = setIn(t, 'defaults', k, '0'); }
  JSON.parse(t); if (t !== readFileSync(f, 'utf8')) { writeFileSync(f, t); n++; }
}
console.log(`parts-gen: ${Object.keys(BIKES).length} bikes, ${n} file(s) changed`);
