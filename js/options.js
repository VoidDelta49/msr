// Options panel (global settings, not per bike)
import { $ } from './util.js';
import { ctx } from './state.js';
import { cfg, save } from './config.js';

const OPTS = { oHud: [{ k: 'showFps', l: 'Show FPS' }, { k: 'showApi', l: 'Show renderer' }], oAud: [{ k: 'sound', l: 'Sound' }], oPhy: [{ k: 'rapier', l: 'Rapier physics (beta)' }], oGfx: [{ k: 'forceGL', l: 'Force WebGL (reloads)' }] };
export const O = { onPerf: null, onPhys: null };
function build() {
  for (const [id, l] of Object.entries(OPTS)) $(id).innerHTML = l.map(t => `<button class="chip${cfg[t.k] ? ' on' : ''}" data-o=${t.k}>${t.l}</button>`).join('');
  $('oCtl').innerHTML = `<div class=row><span>Touch steer sens. <b id=v_sens>${cfg.sens}</b></span><input type=range min=5 max=20 value=${cfg.sens} id=oSens></div>`;
  $('oNote').textContent = $('apiNote').textContent;
}
export function openOpts() { if (ctx.OPT || ctx.GAR) return; build(); $('opts').hidden = false; ctx.OPT = true; document.body.classList.add('opt'); }
export function closeOpts() { if (!ctx.OPT) return; $('opts').hidden = true; ctx.OPT = false; document.body.classList.remove('opt'); }
$('opts').onclick = e => {
  const b = e.target.closest('button[data-o]'); if (!b) return; const k = b.dataset.o; cfg[k] = !cfg[k]; b.classList.toggle('on', cfg[k]); save();
  if (k === 'forceGL') { location.reload(); return; } if (k === 'rapier') O.onPhys(); O.onPerf();
};
$('opts').oninput = e => { if (e.target.id !== 'oSens') return; cfg.sens = +e.target.value; $('v_sens').textContent = cfg.sens; save(); };
$('oClose').onclick = closeOpts; $('bOpt').onclick = openOpts; $('goOpt').onclick = openOpts;
