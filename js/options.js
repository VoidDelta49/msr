// Options panel (global settings, not per bike)
import { $, LOG } from './util.js';
import { ctx } from './state.js';
import { cfg, save, BUILD } from './config.js';

const OPTS = { oHud: [{ k: 'showFps', l: 'Show FPS' }, { k: 'showApi', l: 'Show renderer' }], oAud: [{ k: 'sound', l: 'Sound' }, { k: 'amb', l: 'Ambient sounds' }], oPhy: [{ k: 'tough', l: 'Tough Biker mode' }], oGfx: [{ k: 'n64', l: 'N64 colour filter (reloads)' }, { k: 'fxaa', l: 'Anti-aliasing FXAA (reloads)' }, { k: 'autoRes', l: 'Auto resolution' }, { k: 'gpuCull', l: 'GPU culling, WebGPU only (reloads)' }, { k: 'forceGL', l: 'Force WebGL (reloads)' }] };
const RL = [[0, 'Off'], [480, '480p'], [360, '360p'], [240, '240p']]; // render height cap, upscaled with crisp pixels
const FL = [[30, '30'], [60, '60'], [0, 'Off']]; // FPS cap
const TL = [['live', 'Live PH'], [7, 'Morning'], [12, 'Noon'], [17.3, 'Sunset'], [22, 'Night']]; // time of day (cfg.tod), live = real Philippine time
const QL = { low: 'Low', med: 'Medium', high: 'High' };
// usable from the menu before the game loads: no renderer import (main.js sets setDPR, api, live); reload-only
// settings just save while nothing is loaded yet
export const O = { onPerf: null, setDPR: null, api: '', live: false };
const reload = () => { if (O.live) location.reload(); else build(); };
function build() {
  for (const [id, l] of Object.entries(OPTS)) $(id).innerHTML = l.map(t => `<button class="chip${cfg[t.k] ? ' on' : ''}" data-o=${t.k}>${t.l}</button>`).join('');
  $('oQ').innerHTML = '<span>Quality (reloads)</span>' + Object.entries(QL).map(([q, l]) => `<button class="chip${(cfg.gfx || 'med') === q ? ' on' : ''}" data-q=${q}>${l}</button>`).join('');
  $('oRet').innerHTML = '<span>Retro res</span>' + RL.map(([v, l]) => `<button class="chip${(cfg.retro || 0) === v ? ' on' : ''}" data-r=${v}>${l}</button>`).join('') +
    '<span>Time of day</span>' + TL.map(([v, l]) => `<button class="chip${(cfg.tod ?? 'live') === v ? ' on' : ''}" data-t=${v}>${l}</button>`).join('') +
    '<span>FPS cap</span>' + FL.map(([v, l]) => `<button class="chip${(cfg.fpsCap ?? 60) === v ? ' on' : ''}" data-f=${v}>${l}</button>`).join('');
  $('oAud').insertAdjacentHTML('beforeend', `<div class=row style="flex-basis:100%"><span>Volume <b id=v_vol>${Math.round((cfg.vol ?? .8) * 100)}</b></span><input type=range min=0 max=100 value=${Math.round((cfg.vol ?? .8) * 100)} id=oVol></div>`);
  $('oCtl').innerHTML = `<div class=row><span>Touch steer sens. <b id=v_sens>${cfg.sens}</b></span><input type=range min=5 max=20 value=${cfg.sens} id=oSens></div>`;
  $('oNote').textContent = (O.api || 'Renderer is picked when the game loads') + ' · Build ' + BUILD;
  $('oLog').textContent = LOG.length ? LOG.slice(-12).join('\n') : 'No errors logged';
}
export function openOpts() { if (ctx.OPT || ctx.GAR) return; build(); $('opts').hidden = false; ctx.OPT = true; document.body.classList.add('opt'); }
export function closeOpts() { if (!ctx.OPT) return; $('opts').hidden = true; ctx.OPT = false; document.body.classList.remove('opt'); }
$('opts').onclick = e => {
  const q = e.target.closest('button[data-q]'); if (q) { if (cfg.gfx !== q.dataset.q) { cfg.gfx = q.dataset.q; save(); reload(); } return; }
  const r = e.target.closest('button[data-r]'); if (r) { cfg.retro = +r.dataset.r; save(); if (O.setDPR) O.setDPR(); build(); return; }
  const tb = e.target.closest('button[data-t]'); if (tb) { const v = tb.dataset.t; cfg.tod = v === 'live' ? 'live' : +v; save(); build(); return; }
  const f = e.target.closest('button[data-f]'); if (f) { cfg.fpsCap = +f.dataset.f; save(); build(); return; }
  const b = e.target.closest('button[data-o]'); if (!b) return; const k = b.dataset.o; cfg[k] = !cfg[k]; b.classList.toggle('on', cfg[k]); save();
  if (k === 'forceGL' || k === 'fxaa' || k === 'n64' || k === 'gpuCull') { reload(); return; } if (O.onPerf) O.onPerf();
};
$('opts').oninput = e => { if (e.target.id === 'oVol') { cfg.vol = e.target.value / 100; $('v_vol').textContent = e.target.value; save(); return; } if (e.target.id !== 'oSens') return; cfg.sens = +e.target.value; $('v_sens').textContent = cfg.sens; save(); };
$('oClose').onclick = closeOpts; $('bOpt').onclick = openOpts;
