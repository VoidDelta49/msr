// Options panel (global settings, not per bike)
import { $, LOG } from './util.js';
import { ctx } from './state.js';
import { cfg, save, BUILD } from './config.js';
import { setDPR } from './renderer.js';

const OPTS = { oHud: [{ k: 'showFps', l: 'Show FPS' }, { k: 'showApi', l: 'Show renderer' }], oAud: [{ k: 'sound', l: 'Sound' }], oPhy: [{ k: 'tough', l: 'Tough Biker mode' }], oGfx: [{ k: 'n64', l: 'N64 colour filter (reloads)' }, { k: 'fxaa', l: 'Anti-aliasing FXAA (reloads)' }, { k: 'autoRes', l: 'Auto resolution' }, { k: 'forceGL', l: 'Force WebGL (reloads)' }] };
const RL = [[0, 'Off'], [480, '480p'], [360, '360p'], [240, '240p']]; // render height cap, upscaled with crisp pixels
const QL = { low: 'Low', med: 'Medium', high: 'High' };
export const O = { onPerf: null };
function build() {
  for (const [id, l] of Object.entries(OPTS)) $(id).innerHTML = l.map(t => `<button class="chip${cfg[t.k] ? ' on' : ''}" data-o=${t.k}>${t.l}</button>`).join('');
  $('oQ').innerHTML = '<span>Quality (reloads)</span>' + Object.entries(QL).map(([q, l]) => `<button class="chip${(cfg.gfx || 'med') === q ? ' on' : ''}" data-q=${q}>${l}</button>`).join('');
  $('oRet').innerHTML = '<span>Retro res</span>' + RL.map(([v, l]) => `<button class="chip${(cfg.retro || 0) === v ? ' on' : ''}" data-r=${v}>${l}</button>`).join('');
  $('oCtl').innerHTML = `<div class=row><span>Touch steer sens. <b id=v_sens>${cfg.sens}</b></span><input type=range min=5 max=20 value=${cfg.sens} id=oSens></div>`;
  $('oNote').textContent = $('apiNote').textContent + ' · Build ' + BUILD;
  $('oLog').textContent = LOG.length ? LOG.slice(-12).join('\n') : 'No errors logged';
}
export function openOpts() { if (ctx.OPT || ctx.GAR) return; build(); $('opts').hidden = false; ctx.OPT = true; document.body.classList.add('opt'); }
export function closeOpts() { if (!ctx.OPT) return; $('opts').hidden = true; ctx.OPT = false; document.body.classList.remove('opt'); }
$('opts').onclick = e => {
  const q = e.target.closest('button[data-q]'); if (q) { if (cfg.gfx !== q.dataset.q) { cfg.gfx = q.dataset.q; save(); location.reload(); } return; }
  const r = e.target.closest('button[data-r]'); if (r) { cfg.retro = +r.dataset.r; save(); setDPR(); build(); return; }
  const b = e.target.closest('button[data-o]'); if (!b) return; const k = b.dataset.o; cfg[k] = !cfg[k]; b.classList.toggle('on', cfg[k]); save();
  if (k === 'forceGL' || k === 'fxaa' || k === 'n64') { location.reload(); return; } O.onPerf();
};
$('opts').oninput = e => { if (e.target.id !== 'oSens') return; cfg.sens = +e.target.value; $('v_sens').textContent = cfg.sens; save(); };
$('oClose').onclick = closeOpts; $('bOpt').onclick = openOpts; $('goOpt').onclick = openOpts;
