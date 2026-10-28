// HUD + touch-control layout. Measures the screen (and the notch / home-bar safe area), asks layoutcalc.js where every control goes so
// that nothing overlaps or leaves the screen, and writes the result onto the elements as inline px (css/style.css keeps the old
// clamp()-based positions as the fallback if this file never ran). Re-runs on resize / rotation / URL-bar changes and whenever
// something that changes the layout flips: bike type (scooter / rotary / manual), camera (gauge), left-handed, touch size,
// the FPS readout. Not the main menu or the garage / options panels: those have their own layouts.
import { $ } from './util.js';
import { cfg } from './config.js';
import { solve } from './layoutcalc.js';

// LAYOUT.last = the latest solver result, LAYOUT.ins = optional safe-area override (tools/layout-dom.mjs simulates notches with it)
export const LAYOUT = { last: null, ins: null, key: '' };
const body = document.body;
const probe = document.createElement('div'); // reads env(safe-area-inset-*) back as px
probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
body.appendChild(probe);
const insets = () => { if (LAYOUT.ins) return LAYOUT.ins; const c = getComputedStyle(probe); return { t: parseFloat(c.paddingTop) || 0, r: parseFloat(c.paddingRight) || 0, b: parseFloat(c.paddingBottom) || 0, l: parseFloat(c.paddingLeft) || 0 }; };
const px = v => Math.round(v * 10) / 10 + 'px';
// absolute box: bottom-anchored groups stay glued to the bottom edge even if the browser's idea of the viewport height lags a frame
function put(el, r, H, fromBottom) {
  const s = el.style; s.left = px(r.x); s.right = 'auto'; s.width = px(r.w); s.height = px(r.h); s.transform = 'none';
  if (fromBottom) { s.top = 'auto'; s.bottom = px(H - r.y - r.h); } else { s.bottom = 'auto'; s.top = px(r.y); }
}
const bottomGroup = { wheel: 1, lb: 1, thr: 1, brk: 1, clu: 1, shift: 1, gauge: 1 };
const ELS = { mini: 'mini', top: 'top', perf: 'perf', wheel: 'wheel', lb: 'lb', thr: 'thr', brk: 'brk', clu: 'clu', shift: 'shift', gauge: 'gauge' };
const BANNERS = ['mis', 'race', 'ride'];

export function relayout() {
  const W = innerWidth, H = innerHeight, ins = insets();
  const o = { k: (cfg.ui ?? 10) / 10, touch: body.classList.contains('touch'), cvt: body.classList.contains('cvt'), nocl: body.classList.contains('nocl'), ysh: body.classList.contains('cvt') && body.classList.contains('ysh'), lefty: !!cfg.lefty, cam3: body.classList.contains('cam3'), perf: !$('perf').hidden };
  const key = [W, H, ins.t, ins.r, ins.b, ins.l, o.k, o.touch, o.cvt, o.nocl, o.ysh, o.lefty, o.cam3, o.perf].join();
  if (key === LAYOUT.key) return LAYOUT.last; LAYOUT.key = key;
  const res = LAYOUT.last = solve(W, H, ins, o), r = res.rects, tr = res.tr, por = res.por;
  body.classList.toggle('lay', true); body.classList.toggle('laybad', !res.ok); body.dataset.layout = res.ok ? `${res.mode} f${res.f} t${res.tier}` : 'bad: ' + res.why;
  for (const [k, id] of Object.entries(ELS)) if (r[k]) put($(id), r[k], H, bottomGroup[k]);
  // top button bar: fixed sizes from the density tier (labels were measured against them)
  const top = $('top'), tb = tr.top; top.style.flexDirection = por ? 'column' : 'row'; top.style.alignItems = por ? 'flex-end' : 'stretch'; top.style.gap = tb.gap + 'px';
  [...top.children].forEach((b, i) => { b.style.width = tb.w[i] + 'px'; b.style.height = tb.h + 'px'; b.style.fontSize = tb.fs + 'px'; });
  $('perf').style.textAlign = por ? 'left' : 'right';
  // quest / race / ride banner: same box for all three (only one shows at a time); landscape centres it in its zone
  const bn = tr.ban, bz = r.banner;
  for (const id of BANNERS) {
    // pinned between the zone's left and right edges and sized to its content: portrait keeps it at the left, landscape centres it
    // (left + translateX(-50%) would cap its shrink-to-fit width at the space right of its centre and make it wrap early)
    const el = $(id), s = el.style; s.top = px(bz.y); s.bottom = 'auto'; s.left = px(bz.x); s.right = px(W - bz.x - bz.w); s.width = 'fit-content'; s.height = ''; s.maxWidth = px(bz.w); s.maxHeight = px(bz.h);
    s.transform = 'none'; s.marginLeft = por ? '0' : 'auto'; s.marginRight = 'auto';
    s.setProperty('--bnp', bn.pad + 'px'); s.setProperty('--bng', bn.gap + 'px'); s.setProperty('--bnl', bn.lh + 'px'); s.setProperty('--bnbh', bn.bh + 'px'); s.setProperty('--bnf', bn.fs + 'px'); s.setProperty('--bntw', bn.tw + 'px'); s.setProperty('--bnx', (bn.fs > 12 ? 10 : 8) + 'px');
    bn.bw.forEach((w, i) => s.setProperty('--bw' + i, w + 'px'));
  }
  // GET OFF / GET ON (foot.js): the solver's free spot, or the CSS spot when none is free
  const fo = $('bFoot'), fr = r.foot; if (fr) { put(fo, fr, H, false); fo.style.fontSize = tr.top.fs + 'px'; } else { fo.style.cssText = ''; }
  // on foot (foot.js): the joystick takes the wheel's place and the JUMP button the gas pad's (a round button in its lower part); both only show on foot
  if (r.wheel) put($('joy'), r.wheel, H, true);
  if (r.thr) { const d = Math.min(r.thr.w, r.thr.h); put($('jumpB'), { x: r.thr.x + (r.thr.w - d) / 2, y: r.thr.y + r.thr.h - d, w: d, h: d }, H, true); }
  if (!o.touch || !res.m) return res;
  // thumb controls: engine buttons (one row, or a 2x2 block), shifter, text sizes follow the scale
  const m = res.m, lb = $('lb'), fs = res.s < .85 ? 11 : 13, btn = [...lb.children];
  lb.style.display = res.mode === 'row' ? 'flex' : 'grid'; lb.style.gridTemplateColumns = res.mode === 'row' ? '' : '1fr 1fr'; lb.style.gap = res.mode === 'row' ? '8px' : '6px';
  btn.forEach((b, i) => { b.style.minWidth = '0'; b.style.width = res.mode === 'row' ? m.bw[i] + 'px' : ''; b.style.height = m.lh + 'px'; b.style.fontSize = fs + 'px'; b.style.padding = '0 4px'; });
  [...$('shift').children].forEach(b => { b.style.height = m.sbh + 'px'; });
  // pad captions shrink with their pad (11 px 'THROTTLE ↓' is 7.7em wide incl. letter-spacing; 'CLUTCH' is 4.8em and 'drag ↓ to pull' wraps under it)
  const cap = (el, w, em, max) => { el.querySelector('small').style.fontSize = Math.max(7, Math.min(max, (w - 3) / em)) + 'px'; };
  cap($('thr'), r.thr.w, 7.8, 11); if (r.clu) cap($('clu'), r.clu.w, 5.2, 12);
  return res;
}

let queued = 0;
const schedule = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; relayout(); }); };
addEventListener('resize', schedule);
addEventListener('orientationchange', () => { schedule(); setTimeout(schedule, 300); }); // some browsers report the old size for a moment after a rotation
if (window.visualViewport) visualViewport.addEventListener('resize', schedule);
// observers run before the next paint, so a class flip (gauge appearing, bike switch) is laid out in the same frame it shows up in
new MutationObserver(relayout).observe(body, { attributes: true, attributeFilter: ['class', 'style'] }); // bike type, camera, left-handed, touch size, menu / garage
new MutationObserver(relayout).observe($('perf'), { attributes: true, attributeFilter: ['hidden'] });  // FPS readout on / off
relayout();
