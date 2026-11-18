// Custom touch-control layout: the player drags / resizes the thumb controls on top of the solver's layout (layout.js).
// cfg.tlay = { l: {id: [dx, dy, s]}, p: {...} } per orientation, dx / dy as a fraction of the screen so a resize keeps them in place.
// Edit mode (Options > TOUCH > Edit control layout): tap a control to pick it, drag to move, - / + to resize, Reset, Done.
import { $ } from './util.js';
import { cfg, save } from './config.js';

const IDS = ['wheel', 'lb', 'thr', 'brk', 'clu', 'shift', 'bFoot'], FOLLOW = { joy: 'wheel', jumpB: 'thr' };
const ori = () => innerHeight > innerWidth ? 'p' : 'l';
const lay = () => { const t = cfg.tlay || (cfg.tlay = {}); return t[ori()] || (t[ori()] = {}); };
function set(el, v) { const s = el.style; if (!v) { s.translate = ''; s.scale = ''; return; } s.translate = `${v[0] * innerWidth}px ${v[1] * innerHeight}px`; s.scale = String(v[2]); }
// uses the CSS translate / scale properties so layout.js's transform:none never fights it; hit tests follow them
export function applyTlay() {
  const L = (cfg.tlay || {})[ori()] || {};
  for (const id of IDS) { const el = $(id); if (el) set(el, L[id]); }
  for (const [id, f] of Object.entries(FOLLOW)) { const el = $(id); if (el) set(el, L[f]); }
}

let sel = null, drag = null, bar = null;
const B = document.body;
function pick(el) { if (sel) sel.classList.remove('tsel'); sel = el; if (el) el.classList.add('tsel'); }
function down(e) {
  if (!B.classList.contains('tedit') || e.target.closest('#tbar')) return;
  const el = e.target.closest(IDS.map(i => '#' + i).join(',')); e.stopPropagation(); e.preventDefault(); if (!el) return;
  pick(el); const v = lay()[el.id] || [0, 0, 1]; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v: v.slice() };
}
function move(e) {
  if (!drag || e.pointerId !== drag.id) return; e.stopPropagation(); e.preventDefault();
  const v = drag.v; lay()[sel.id] = [v[0] + (e.clientX - drag.x) / innerWidth, v[1] + (e.clientY - drag.y) / innerHeight, v[2]]; applyTlay();
}
function up(e) { if (!B.classList.contains('tedit')) return; e.stopPropagation(); if (drag && e.pointerId === drag.id) { drag = null; save(); } }
for (const [t, f] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up]]) addEventListener(t, f, true);
function size(d) { if (!sel) return; const v = lay()[sel.id] || [0, 0, 1]; v[2] = Math.max(.5, Math.min(2, Math.round((v[2] + d) * 10) / 10)); lay()[sel.id] = v; applyTlay(); save(); }
export function editTlay() {
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'tbar';
    bar.innerHTML = '<span>Drag a control · pick one to resize</span><button class=b data-t=-1>−</button><button class=b data-t=1>+</button><button class=b data-t=r>Reset</button><button class="b on" data-t=d>Done</button>';
    bar.onclick = e => {
      const t = (e.target.closest('button') || {}).dataset?.t; if (!t) return;
      if (t === 'd') { B.classList.remove('tedit'); pick(null); bar.hidden = true; return; }
      if (t === 'r') { if (sel) delete lay()[sel.id]; else (cfg.tlay || {})[ori()] = {}; applyTlay(); save(); return; }
      size(+t * .1);
    };
    B.appendChild(bar);
  }
  bar.hidden = false; B.classList.add('tedit'); pick(null);
}
addEventListener('resize', () => requestAnimationFrame(applyTlay));
