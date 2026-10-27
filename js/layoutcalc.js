// Touch / HUD layout solver. Pure maths, no DOM: layout.js feeds it the window size and applies the rectangles it returns,
// tools/layout.mjs sweeps it over phone sizes and checks that nothing overlaps or leaves the screen,
// tools/layout-dom.mjs checks the same in a real browser against the real DOM.
//
// Every on-screen control gets a rectangle in px. Sizes start from the screen (same curves the old CSS used), are
// multiplied by Options > touch control size (k), then by a fit factor f <= 1 that is lowered step by step until every
// rectangle is inside the safe area and no two rectangles touch. Search order: density tier (0 normal, 1 compact top bar /
// banner buttons, only when the screen is too small for tier 0), engine-button arrangement (one row, or a 2x2 block above
// the wheel), then f. The gauge tries a few spots; the quest / race banner tries beside or below the button bar.
// Left-handed mode mirrors the two thumb clusters only; the top band (minimap left, buttons right) stays put.
const E = 12, T = 8, V = 10, G = 12; // edge margin, top margin, vertical / horizontal gap between control groups
export const GAP = 4;                // minimum clear space between any two rectangles
export const FMIN = .5;              // never shrink below half size; below that the layout is reported as not ok
export const BANNER_MIN_W = 120;     // narrowest quest / race banner that is still readable
const cl = (v, a, b) => v < a ? a : v > b ? b : v;
export const hit = (a, b, p = 0) => a.x < b.x + b.w + p && b.x < a.x + a.w + p && a.y < b.y + b.h + p && b.y < a.y + a.h + p;

// Density tiers. top: the five buttons of #top (menu, CAM: 3RD, GARAGE, RESET, options) as heights / widths / gap (label widths measured
// in Chromium at 13 / 11 px bold plus padding and ~12% for Roboto / SF; tools/layout-dom.mjs fails if a label ever overflows its button).
// ban: quest / race / ride banner (#mis #race #ride): text line height, button height, button widths (worst case: the four
// buttons of the race banner), padding, gap, text width it asks for before wrapping the buttons below it.
export const TIERS = [
  { top: { h: 44, w: [44, 86, 76, 62, 44], gap: 6, fs: 13 }, ban: { lh: 15, bh: 40, bw: [80, 96, 82, 44], pad: 8, gap: 8, tw: 150, fs: 13 }, mini: 1 },
  { top: { h: 36, w: [38, 72, 64, 52, 38], gap: 4, fs: 11 }, ban: { lh: 14, bh: 34, bw: [72, 86, 74, 38], pad: 6, gap: 6, tw: 120, fs: 12 }, mini: .85 }
];
const topSize = (t, por) => por ? { w: Math.max(...t.w), h: 5 * t.h + 4 * t.gap } : { w: t.w.reduce((a, b) => a + b, 0) + 4 * t.gap, h: t.h };

// Height a banner needs at width w: the text (two lines at most) first, then the buttons, wrapped like flex-wrap does (css/style.css, #mis #race #ride).
export function bannerH(w, b) {
  const cw = w - 2 * b.pad - 2, items = [Math.min(b.tw, cw), ...b.bw]; let rows = [{ w: 0, h: 0 }];
  items.forEach((iw, i) => { let r = rows[rows.length - 1]; if (r.w && r.w + b.gap + iw > cw) rows.push(r = { w: 0, h: 0 }); r.w += (r.w ? b.gap : 0) + iw; r.h = Math.max(r.h, i ? b.bh : 2 * b.lh); });
  return 2 + 2 * b.pad + rows.reduce((a, r) => a + r.h, 0) + (rows.length - 1) * b.gap;
}

/* o: { k size multiplier, touch, cvt, nocl, lefty, cam3, perf (readout shown) } */
function build(W, H, ins, o, f, mode, tier) {
  const por = W <= H, s = o.k * f, r = {}, L = ins.l + E, R = W - ins.r - E, B = H - ins.b - E, tr = TIERS[tier];
  // ---- top band: minimap (left), button bar (right), readout, quest / race banner ----
  const mini = (por ? Math.min(104, .27 * W) : H <= 380 ? Math.min(104, .28 * H) : Math.min(120, .26 * H)) * tr.mini, mx = ins.l + T, my = ins.t + T;
  r.mini = { x: mx, y: my, w: mini, h: mini };
  const top = topSize(tr.top, por);
  r.top = { x: W - ins.r - T - top.w, y: my, w: top.w, h: top.h };
  const mb = my + mini + 4; // first free y under the minimap
  if (o.perf) r.perf = por ? { x: mx, y: mb, w: Math.min(190, .5 * W), h: 42 } : { x: W - ins.r - T - Math.min(220, .4 * W), y: my + top.h + 4, w: Math.min(220, .4 * W), h: 42 };
  let ban; // [x0, x1, y0] candidates, best (lowest bottom edge) wins; "beside" is preferred on ties
  if (por) {
    const y0 = (r.perf ? r.perf.y + r.perf.h : mb) + 4, xr = W - ins.r - T;
    ban = [[mx, r.top.x - T, y0], [mx, xr, Math.max(y0, r.top.y + r.top.h + 4)]];
  } else ban = [[mx + mini + T, r.top.x - T, my], [mx, W - ins.r - T, Math.max(mb, r.top.y + r.top.h + 4, r.perf ? r.perf.y + r.perf.h + 4 : 0)]];
  let bb = null; for (const [x0, x1, y0] of ban) { const w = x1 - x0; if (w < BANNER_MIN_W) continue; const h = bannerH(w, tr.ban); if (!bb || y0 + h < bb.y + bb.h - 1) bb = { x: x0, y: y0, w, h }; }
  if (!bb) return { r, bad: 'banner zone too narrow', mode };
  r.banner = bb;
  if (!o.touch) return { r, bad: check(W, H, ins, r), mode };
  // ---- thumb clusters (drawn right-handed, mirrored at the end for left-handed) ----
  const z = por ? { w: cl(.40 * W, 104, 172), tw: cl(.26 * W, 88, 120), th: cl(.17 * H, 112, 150), cw: cl(.21 * W, 72, 112) }
                : { w: cl(.38 * H, 110, 160), tw: cl(.15 * W, 96, 120), th: cl(.32 * H, 104, 132), cw: cl(.17 * W, 84, 130) };
  const w = z.w * s, tw = z.tw * s, th = z.th * s, cw = z.cw * s;
  const lh = Math.max(40, 50 * s), sbh = Math.max(40, 52 * s), bh = Math.max(44, 56 * s), sh = 2 * sbh + 8;
  const bw = (por ? [48, 48, 72, 74] : [54, 54, 84, 80]).map((v, i) => Math.max([46, 46, 64, 70][i], v * s));
  const rowW = bw[0] + bw[1] + bw[2] + bw[3] + 3 * 8, gridW = Math.max(w, 144), gridH = 2 * lh + 6;
  r.wheel = { x: L, y: B - w, w, h: w };
  r.lb = mode === 'row' ? { x: L, y: B - w - V - lh, w: rowW, h: lh } : { x: L, y: B - w - V - gridH, w: gridW, h: gridH };
  r.thr = { x: R - tw, y: B - th, w: tw, h: th };
  const px = R - tw - G - cw; // the pad column left of the throttle
  if (o.cvt) r.brk = { x: px, y: B - th, w: cw, h: th };               // scooter: the brake lever becomes the big pad
  else {
    r.brk = { x: R - tw, y: B - th - V - bh, w: tw, h: bh };
    if (o.nocl) r.shift = { x: px, y: B - sh, w: cw, h: sh };            // rotary semi-auto: shifter only
    else { r.clu = { x: px, y: B - th, w: cw, h: th }; r.shift = { x: px, y: B - th - V - sh, w: cw, h: sh }; }
  }
  if (o.lefty) for (const k of ['wheel', 'lb', 'thr', 'brk', 'clu', 'shift']) if (r[k]) r[k] = { ...r[k], x: L + R - r[k].x - r[k].w };
  // ---- gauge (3rd person only): first spot that is free, widest first ----
  if (o.cam3) {
    const gwMax = por ? Math.min(200, .44 * W) : Math.min(210, .24 * W), dir = o.lefty ? -1 : 1, gh = gw => gw * 224 / 512;
    const spots = [
      gw => ({ x: dir > 0 ? r.wheel.x + r.wheel.w + 16 : r.wheel.x - 16 - gw, y: B - gh(gw) }),                // beside the wheel
      gw => ({ x: o.lefty ? R - gw : L, y: r.lb.y - V - gh(gw) }),                                              // above the engine buttons
      gw => ({ x: (W - gw) / 2, y: Math.max(r.banner.y + r.banner.h, r.top.y + r.top.h, r.mini.y + r.mini.h) + T }), // top centre, under the banner
      gw => ({ x: (W - gw) / 2, y: B - gh(gw) })                                                                // bottom centre, between the thumb clusters
    ];
    if (por) spots.unshift(spots.splice(1, 1)[0]);
    place: for (const sp of spots) for (let gw = gwMax; gw >= 110; gw -= 10) {
      const g = { ...sp(gw), w: gw, h: gh(gw) }; r.gauge = g;
      if (!check(W, H, ins, r)) break place; r.gauge = null;
    }
    if (!r.gauge) return { r, bad: 'no free spot for the gauge', mode };
  }
  return { r, bad: check(W, H, ins, r), mode, m: { bw, lh, sbh, sh, bh } };
}

// first problem found, or '' when every rectangle is inside the safe area and no two are closer than GAP
function check(W, H, ins, r) {
  const names = Object.keys(r).filter(k => r[k]);
  for (const k of names) { const a = r[k]; if (a.x < ins.l - .01 || a.y < ins.t - .01 || a.x + a.w > W - ins.r + .01 || a.y + a.h > H - ins.b + .01) return k + ' leaves the safe area'; }
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (hit(r[names[i]], r[names[j]], GAP)) return names[i] + ' overlaps ' + names[j];
  return '';
}

export function solve(W, H, ins, o) {
  const por = W <= H, modes = o.touch ? (por ? ['grid', 'row'] : ['row', 'grid']) : ['row'], found = [];
  // best fit per (tier, arrangement); a compact tier costs a little, so it only wins when it keeps the thumb controls clearly bigger
  for (let tier = 0; tier < TIERS.length; tier++) for (const mode of modes) for (let f = 1; f >= FMIN - 1e-9; f -= .02) { const b = build(W, H, ins, o, f, mode, tier); if (!b.bad) { found.push({ ...b, f, tier, score: f - tier * .08 }); break; } }
  // prefer the first candidate (tier 0, the orientation's usual arrangement) unless a later one scores clearly better
  let best = found[0]; for (const c of found) if (c.score > best.score + .06) best = c;
  if (best) return { ok: true, f: Math.round(best.f * 100) / 100, s: o.k * best.f, mode: best.mode, tier: best.tier, por, rects: best.r, m: best.m, tr: TIERS[best.tier], why: '' };
  const b = build(W, H, ins, o, FMIN, modes[0], TIERS.length - 1); // nothing fits: best effort at the smallest size, flagged so the sweep lists it
  return { ok: false, f: FMIN, s: o.k * FMIN, mode: modes[0], tier: TIERS.length - 1, por, rects: b.r, m: b.m, tr: TIERS[TIERS.length - 1], why: b.bad };
}
