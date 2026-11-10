// Outfits as data (pure: no three.js, no DOM, so tools/npc.mjs runs it headless). A figure's look is 16 colour roles + a mask of
// optional parts; figure.js draws any look with the same geometry and shader. data/npc.json describes looks per archetype:
//   colour value  '#rrggbb' | '@palette' (random entry of palettes[palette]) | '=role' (same as another role) | [ ...one of these ]
//   pack with no colour given = a random palettes.rain colour (it is also the payong / kapote), fur2 = the straw hat
//   opt           { part: chance }   excl: [[part, part], ...] never together   skirtShin: colour of the shins under a skirt
export const ROLES = ['skin', 'hair', 'top', 'sleeve', 'forearm', 'hand', 'thigh', 'shin', 'shoe', 'acc', 'pack', 'dark', 'tie', 'bag', 'fur2', 'eye'];
export const ROLE = Object.fromEntries(ROLES.map((r, i) => [r, i]));
export const PARTS = ['cap', 'helmet', 'long', 'pack', 'skirt', 'tie', 'bag', 'phone', 'hat', 'umb', 'coat']; // bit k of the mask = PARTS[k]
export const OPT = Object.fromEntries(PARTS.map((p, i) => [p, i + 1]));
export const optMask = names => names.reduce((m, n) => OPT[n] ? m | (1 << (OPT[n] - 1)) : m, 0);
export const hasPart = (mask, n) => !!((mask >> (OPT[n] - 1)) & 1);
const DEF = { skin: '#c08a5e', hair: '#1d1a18', top: '#e9e4d8', sleeve: '=top', forearm: '=skin', hand: '=skin', thigh: '#2d3d63', shin: '=thigh', shoe: '#e9e6df', acc: '#2b2d33', pack: '@rain', dark: '#1f2226', tie: '#24324f', bag: '#8c6b4a', fur2: '#d9c48f', eye: '#1d1a18' };

export const hexInt = s => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s).trim()); return m ? parseInt(m[1], 16) : NaN; };
// one colour value -> '#rrggbb' or '=role' (references are resolved afterwards); null when it can't be read
export function pickColour(v, pal, rnd) {
  for (let k = 0; k < 8; k++) {
    if (Array.isArray(v)) { if (!v.length) return null; v = v[(rnd() * v.length) | 0]; continue; }
    if (typeof v !== 'string') return null;
    if (v[0] === '@') { const L = pal[v.slice(1)]; if (!Array.isArray(L) || !L.length) return null; v = L[(rnd() * L.length) | 0]; continue; }
    if (v[0] === '=') return ROLE[v.slice(1)] === undefined ? null : v;
    return Number.isFinite(hexInt(v)) ? v : null;
  }
  return null;
}
// archetype -> { pal: [16 sRGB ints], mask }. Problems (bad colour, unknown role) go to `err` instead of throwing.
export function resolveLook(arch, pal, rnd, err = null) {
  const opt = arch.opt || {}, on = [];
  for (const p of Object.keys(opt)) { if (OPT[p] === undefined) { if (err) err.push('unknown part ' + p); continue; } if (rnd() < opt[p]) on.push(p); }
  for (const g of arch.excl || []) { const hit = g.filter(p => on.includes(p)); for (const p of hit.slice(1)) on.splice(on.indexOf(p), 1); }
  const want = { ...DEF, ...(arch.look || {}) }; if (on.includes('skirt') && arch.skirtShin) want.shin = arch.skirtShin;
  const raw = {};
  for (const r of ROLES) { const c = pickColour(want[r], pal, rnd); if (c === null) { if (err) err.push(`role ${r}: cannot read ${JSON.stringify(want[r])}`); raw[r] = DEF[r][0] === '#' ? DEF[r] : r === 'pack' ? '#24324f' : '#808080'; } else raw[r] = c; }
  for (const r of Object.keys(arch.look || {})) if (ROLE[r] === undefined && err) err.push('unknown role ' + r);
  const out = new Array(16), get = (r, d = 0) => { const v = raw[r]; if (v[0] !== '=') return hexInt(v); if (d > 6) { if (err) err.push('role reference loop at ' + r); return 0x808080; } return get(v.slice(1), d + 1); };
  for (const r of ROLES) out[ROLE[r]] = get(r);
  return { pal: out, mask: optMask(on) };
}
