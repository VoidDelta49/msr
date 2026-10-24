// N64-style textures: tiny (16-128 px), painted per pixel with a few shades of each colour and ordered dither between
// them, then bilinear-filtered on the GPU. That soft, chunky texel look is most of the "N64" feel.
// Own seeded RNG (never touch util.rand: the island layout depends on its sequence).
import * as THREE from 'three';

let seed = 7; const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; // 4x4 Bayer
const dith = (x, y) => (BAY[(y & 3) * 4 + (x & 3)] + .5) / 16;
const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
// tileable value noise: grid of `cells` random values, wrapped, smoothstep-interpolated, `oct` octaves
function noise(w, h, cells, oct = 2) {
  const out = new Float32Array(w * h);
  for (let o = 0, amp = 1, tot = 0; o < oct; o++, amp *= .5) {
    const n = cells << o, g = Array.from({ length: n * n }, rnd); tot += amp;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / w * n, fy = y / h * n, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
      const a = g[(j % n) * n + i % n], b = g[(j % n) * n + (i + 1) % n], c = g[((j + 1) % n) * n + i % n], d = g[((j + 1) % n) * n + (i + 1) % n];
      out[y * w + x] += amp * (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv);
    }
    if (o === oct - 1) for (let k = 0; k < out.length; k++) out[k] /= tot;
  }
  return out;
}
// canvas from a per-pixel function returning [r,g,b]
function paint(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = fn(x, y), k = (y * w + x) * 4; im.data[k] = p[0]; im.data[k + 1] = p[1]; im.data[k + 2] = p[2]; im.data[k + 3] = 255; }
  g.putImageData(im, 0, 0); return c;
}
// pick from a palette ramp by value t (0..1) with ordered dither between neighbouring shades
const ramp = (P, t, x, y) => { const f = Math.max(0, Math.min(P.length - 1.001, t * (P.length - 1) + dith(x, y) - .5)); return P[Math.floor(f + .5)] || P[P.length - 1]; };
const R = (...c) => c.map(hex);

export function mkTex(canvas, rep, opt = {}) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = opt.aniso || 1;
  if (rep) Array.isArray(rep) ? t.repeat.set(rep[0], rep[1]) : t.repeat.set(rep, rep); return t;
}

/* ---------- ground ---------- */
export function asphalt() { // dark, mottled, light grit, a couple of cracks
  const n = noise(64, 64, 4, 3), P = R(0x2b2d30, 0x34363a, 0x3d3f43, 0x46484c);
  const cr = new Set(); for (let k = 0; k < 1; k++) { let x = rnd() * 64, y = rnd() * 64, a = rnd() * 6; for (let s = 0; s < 40; s++) { cr.add((Math.floor(y) & 63) * 64 + (Math.floor(x) & 63)); a += (rnd() - .5) * .9; x += Math.cos(a); y += Math.sin(a); } }
  return paint(64, 64, (x, y) => cr.has(y * 64 + x) ? [38, 39, 42] : rnd() < .05 ? [92, 93, 96] : ramp(P, n[y * 64 + x], x, y));
}
export function concrete() { // slabs with joints (2 per tile), light stains
  const n = noise(64, 64, 4, 3), P = R(0x8a877f, 0x96938b, 0xa19e96, 0xadaaa2);
  return paint(64, 64, (x, y) => (x % 32 === 0 || y % 32 === 0) ? [104, 101, 95] : (x % 32 === 1 || y % 32 === 1) ? [176, 173, 166] : ramp(P, n[y * 64 + x] * .9 + rnd() * .1, x, y));
}
// terrain detail: multiplies the vertex colours. Average stays ~#d6 (the old speck texture's tone) so the colours keep their balance.
export function detail() {
  const n = noise(64, 64, 4, 3), P = R(0xb2b2b2, 0xc4c4c4, 0xd6d6d6, 0xe6e6e6, 0xf4f4f4);
  const blade = new Set(); for (let k = 0; k < 140; k++) { const x = (rnd() * 64) | 0, y = (rnd() * 64) | 0; blade.add(y * 64 + x); blade.add(((y + 1) & 63) * 64 + x); }
  return paint(64, 64, (x, y) => blade.has(y * 64 + x) ? [250, 250, 250] : blade.has(((y + 63) & 63) * 64 + ((x + 1) & 63)) ? [168, 168, 168] : ramp(P, n[y * 64 + x], x, y));
}
// roads: u across (0..1 = full width), v along (1 tile = 4.5 m). Philippine concrete roads: slab joint across + down the middle, tyre-worn lanes.
function road(hwy) {
  const n = noise(32, 64, 2, 3), P = R(0x8f8c86, 0x9b9892, 0xa6a39d, 0xb1aea8);
  return paint(32, 64, (x, y) => {
    if (y === 0) return [96, 94, 90];
    if (hwy) { if (x === 1 || x === 30) return [236, 234, 226]; if ((x === 15 || x === 16) && y > 10 && y < 42) return [226, 186, 40]; }
    else if (x === 15 || x === 16) return x === 15 ? [112, 110, 105] : [150, 147, 141];
    const lane = Math.min(Math.abs(x - 8), Math.abs(x - 23)), wear = lane < 3 ? -.18 * (1 - lane / 3) : 0, edge = (x < 2 || x > 29) ? -.15 : 0;
    return ramp(P, n[y * 32 + x] + wear + edge, x, y);
  });
}
export const roadSt = () => road(false), roadHwy = () => road(true);
export function paddy() { // plots with dikes; rows of rice; some flooded (sky reflections)
  const N = 128, plots = []; for (let j = 0; j < 8; j++) for (let i = 0; i < 6; i++) { const r = rnd(); plots.push(r < .45 ? 0 : r < .75 ? 1 : r < .9 ? 2 : 3); }
  const n = noise(N, N, 8, 2), G = [R(0x5f9e2c, 0x6fb034, 0x80c23e), R(0x86c446, 0x98d24f, 0xaadf5c), R(0x5c8f9a, 0x6fa3ad, 0x8bbcc2), R(0xa8a64a, 0xbab656, 0xcac664)];
  return paint(N, N, (x, y) => {
    const pw = N / 6, ph = N / 8, i = Math.floor(x / pw), j = Math.floor(y / ph), lx = x - i * pw, ly = y - j * ph;
    if (lx < 1.5 || ly < 1.5) return ramp(R(0x5e4c30, 0x6b5a3a, 0x7a6846), n[y * N + x], x, y);
    const t = plots[j * 6 + i], row = t === 2 ? (rnd() < .08 ? .9 : 0) : (x % 3 === 0 ? -.25 : .1);
    return ramp(G[t], n[y * N + x] * .7 + row, x, y);
  });
}
export function court() {
  const c = paint(32, 64, (x, y) => ramp(R(0x2a7353, 0x2f7d5b, 0x358763), (x * 7 + y * 3) % 5 / 5, x, y)), g = c.getContext('2d');
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 1; g.strokeRect(1.5, 1.5, 29, 61); g.beginPath(); g.moveTo(1, 32); g.lineTo(31, 32); g.stroke();
  g.beginPath(); g.arc(16, 32, 5, 0, 7); g.stroke(); g.beginPath(); g.arc(16, 1, 10, 0, Math.PI); g.stroke(); g.beginPath(); g.arc(16, 63, 10, Math.PI, 0); g.stroke(); return c;
}
export function sea() { // light wave streaks on a soft blue-green ramp (multiplies the sea colour)
  const n = noise(64, 64, 4, 3);
  return paint(64, 64, (x, y) => { const v = n[y * 64 + x], s = Math.sin((y + n[((y * 3) & 63) * 64 + x] * 18) * .6); return ramp(R(0xb8c4c8, 0xd2dcdf, 0xe9eff0, 0xffffff), v * .6 + (s > .85 ? .5 : 0), x, y); });
}

/* ---------- buildings ---------- */
// Walls, one 32x32 block per floor (white: the instance colour paints the house). Ground floor of n-storey shophouses:
// a roll-up shutter under a sign board; upper floors: jalousie windows with sills. n = 1 also serves the bungalows.
export function walls(n) {
  const W = 32, H = 32 * n, wn = noise(W, H, 2, 2), sign = R(0xc8402a, 0x2a62b8, 0xe0b52a, 0x3f9a4a)[(rnd() * 4) | 0];
  return paint(W, H, (x, y) => {
    const f = Math.floor(y / 32), ly = y - f * 32, top = f === 0; // canvas y=0 is the top floor (texture v=1 = top of the box)
    const base = ramp(R(0xd9d6cf, 0xe6e3dc, 0xf2efe8), wn[y * W + x], x, y);
    if (ly === 31) return [150, 146, 140];                                         // floor line / slab edge
    const ground = f === n - 1;
    if (ground && n > 1) {
      if (ly >= 4 && ly < 10 && x > 1 && x < 30) return ly === 4 || ly === 9 ? [70, 60, 50] : (x + ly) % 4 === 0 ? [240, 236, 220] : sign; // sign board with "lettering"
      if (ly >= 12 && x > 3 && x < 28) return (ly % 2) ? [118, 122, 126] : [150, 154, 158];                                  // shutter
    }
    if (ground && n === 1) { if (x >= 12 && x < 20 && ly >= 12) return ly === 12 || x === 12 || x === 19 ? [70, 48, 32] : [104, 70, 44]; } // door
    const win = ground && n === 1 ? (x >= 3 && x < 10 || x >= 22 && x < 29) && ly >= 10 && ly < 22 : !ground && (x >= 4 && x < 14 || x >= 18 && x < 28) && ly >= 8 && ly < 22;
    if (win) { const wx = x < 16 ? x : x - 16; return (ly % 3 === 0) ? [150, 170, 182] : (wx + ly) % 7 === 0 ? [140, 170, 196] : [52, 70, 88]; }
    if ((ground && n === 1 ? ly === 22 : ly === 22) && ((x >= 2 && x < 11) || (x >= 17 && x < 30))) return [168, 164, 156]; // sills
    return top && ly < 2 ? [190, 186, 178] : base;
  });
}
export function tin() { // corrugated roof ribs + rust spots (white: the instance colour paints the roof)
  const n = noise(32, 32, 4, 2);
  return paint(32, 32, (x, y) => { const rib = [.55, .8, 1, .9, .7][x % 5], rust = n[y * 32 + x] > .72; const v = Math.round(255 * rib * (rust ? .78 : 1)); return rust ? [v, Math.round(v * .82), Math.round(v * .7)] : [v, v, v]; });
}
export function bark() { // palm / tree trunk rings
  return paint(16, 32, (x, y) => ramp(R(0x7c6a52, 0x958067, 0xae9a80, 0xc7b39a), (y % 4 === 0 ? .1 : .65) + (x % 5 === 0 ? -.15 : 0) + rnd() * .2, x, y));
}
export function frond() { // palm leaf: dark spine, light leaflets slanting out
  return paint(32, 32, (x, y) => { const d = Math.abs(x - 16); if (d < 1) return [70, 92, 40]; const s = (y + d) % 6; return ramp(R(0x2f6b22, 0x3f8a2b, 0x58a83a, 0x78c44c), s < 2 ? .9 : s < 4 ? .55 : .2, x, y); });
}
export function leaves() { // canopy clumps (greyscale-ish: instance colour gives the tree its green)
  const n = noise(32, 32, 4, 3);
  return paint(32, 32, (x, y) => { const v = n[y * 32 + x], c = (x * 13 + y * 7) % 9 === 0; return c ? [255, 255, 255] : ramp(R(0x9a9a9a, 0xb8b8b8, 0xd8d8d8, 0xf2f2f2), v, x, y); });
}
export function jeep() { // jeepney side: window band, chrome strip, painted stripes (instance colour = body colour)
  return paint(32, 32, (x, y) => {
    if (y >= 4 && y < 12) return x % 8 === 0 ? [210, 210, 210] : [34, 44, 54];      // windows with pillars
    if (y === 13 || y === 14) return [235, 235, 238];                                  // chrome strip
    if (y >= 17 && y < 20) return [60, 60, 70];                                        // dark stripe
    if (y >= 21 && y < 23) return (x >> 2) & 1 ? [255, 255, 255] : [200, 200, 205];   // checks
    return y > 28 ? [90, 90, 95] : [250, 250, 250];
  });
}

/* ---------- sky ---------- */
// Equirect sky for a camera-following dome: zenith blue to a hazy horizon (= fog colour), puffy clouds near the horizon.
// cloud mask for the day/night sky dome (256×64, horizon at the middle; same noise call the old sky texture used): R = cloud cover, G = top brightness
export function clouds() {
  const W = 256, H = 64, n = noise(W, H, 8, 4);
  return paint(W, H, (x, y) => {
    const v = y / (H - 1); if (v >= .5) return [0, 0, 0];
    const band = Math.exp(-(((v - .36) / .1) ** 2)), k = Math.min(1, Math.max(0, (n[y * W + x] * band - .3) / .14)), w = k * k * (3 - 2 * k);
    return [Math.round(w * 255), Math.round(Math.min(1, w * 1.6) * 255), 0];
  });
}

/* ---------- bike decals ---------- */
export function plate() { // Philippine-style white plate, blocky characters
  const c = paint(32, 16, (x, y) => (x === 0 || y === 0 || x === 31 || y === 15) ? [30, 60, 140] : [246, 246, 240]), g = c.getContext('2d');
  g.fillStyle = '#111'; g.font = 'bold 9px monospace'; g.textBaseline = 'middle'; g.fillText('MSR49', 2, 9); return c;
}
export function stripes(a, b) { // angular two-tone stripes on black (Raider shroud graphic)
  return paint(32, 32, (x, y) => { const d = x + y * .9; return d > 14 && d < 20 ? hex(a) : d > 22 && d < 25 ? hex(b) : [22, 23, 26]; });
}

/* ---------- bike details ---------- */
export function grille() { // radiator: dark core with silver honeycomb-ish mesh lines
  return paint(16, 16, (x, y) => ((x + (y >> 2 & 1) * 2) % 4 === 0 || y % 4 === 0) ? [168, 172, 178] : [26, 28, 31]);
}
export function ribs() { // rubber floor mat ribs
  return paint(8, 16, (x, y) => y % 4 < 2 ? [58, 60, 64] : [24, 25, 27]);
}
