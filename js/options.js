// Options panel (global settings, not per bike). Five tabs; every setting is a switch, a segmented choice or a slider
// with a one-line hint. Settings that rebuild the renderer (RELOAD) are only saved and flagged "applies on reload": one
// "Apply & reload" bar covers all of them, so changing three graphics settings is one reload, not three. Everything else
// applies live. Usable from the main menu before the game loads: no renderer import (main.js sets O.setDPR, O.api, O.gpu,
// O.aa and calls O.snap() once the game is built); reload-only settings just save while nothing is loaded yet.
import { $, LOG } from './util.js';
import { ctx } from './state.js';
import { cfg, save, BUILD, GLOBAL_DEF, AA_MODES, QUALITY } from './config.js';

export const O = { onPerf: null, setDPR: null, api: '', live: false, gpu: false, aa: null, snap };

/* ---------- what needs a reload ---------- */
const RELOAD = { gfx: 'Quality', aa: 'Anti-aliasing', ibl: 'Sky lighting', grade: 'Colour grading', nightFx: 'Night vision', n64: 'N64 filter', mblur: 'Motion blur', gpuCull: 'GPU culling', forceGL: 'Force WebGL' };
let boot = null; // the RELOAD values the running game was built with
function snap() { boot = {}; for (const k in RELOAD) boot[k] = cfg[k]; }
const pending = () => O.live && boot ? Object.keys(RELOAD).filter(k => cfg[k] !== boot[k]) : [];
let PK = []; // pending() as of the last render

/* ---------- touch layout ---------- */
// size multiplier (--k) and mirrored thumb clusters (style.css, "touch layout")
function applyUi() { document.body.style.setProperty('--k', (cfg.ui ?? 10) / 10); document.body.classList.toggle('lefty', !!cfg.lefty); }
applyUi();

/* ---------- choices ---------- */
const GFX = [['low', 'Low'], ['med', 'Medium'], ['high', 'High']];
const RES = [[0, 'Off'], [480, '480p'], [360, '360p'], [240, '240p']]; // render height cap, upscaled with crisp pixels
const FPS = [[30, '30 fps'], [60, '60 fps'], [0, 'Uncapped']];
const TOD = [['live', 'Live PH'], [7, 'Morning'], [12, 'Noon'], [17.3, 'Sunset'], [22, 'Night']]; // cfg.tod; live = real Philippine time
const AAH = {
  off: 'Sharpest and fastest, with jagged edges.',
  fxaa: 'One cheap post pass that softens edges a little. The best choice for phones.',
  msaa2: 'Smooths the edges of shapes. A moderate GPU cost.',
  msaa4: 'The cleanest shape edges. Costs GPU time and memory, which phones feel most.',
  msaa4fx: 'MSAA plus FXAA: also smooths wheel cut-outs, signs and shiny highlights. The heaviest.',
};
// one tap sets all of these (the rest of the look, filters and so on, is a matter of taste and is left alone)
const PRESETS = [
  ['perf', 'Performance', { gfx: 'low', aa: 'off', ibl: false, autoRes: true }],
  ['bal', 'Balanced', { gfx: 'med', aa: 'fxaa', ibl: true, autoRes: true }],
  ['qual', 'Quality', { gfx: 'high', aa: 'msaa4', ibl: true, autoRes: true }],
];
const presetOf = () => (PRESETS.find(([, , v]) => Object.entries(v).every(([k, x]) => cfg[k] === x)) || ['custom'])[0];
// sliders: ranges and how the stored value reads on screen
const SL = {
  sens: { min: 5, max: 20, get: () => cfg.sens, set: v => cfg.sens = v, fmt: v => (v / 10).toFixed(1) + '×' },
  ui: { min: 7, max: 14, get: () => cfg.ui ?? 10, set: v => { cfg.ui = v; applyUi(); }, fmt: v => (v / 10).toFixed(1) + '×' },
  fov: { min: 50, max: 110, get: () => cfg.fov ?? 72, set: v => cfg.fov = v, fmt: v => v + '°' },
  mbAmt: { min: 1, max: 10, get: () => cfg.mbAmt ?? 5, set: v => cfg.mbAmt = v, fmt: v => v * 10 + '%' },
  vol: { min: 0, max: 100, get: () => Math.round((cfg.vol ?? .8) * 100), set: v => cfg.vol = v / 100, fmt: v => v + '%' },
};
const NUM = new Set(['retro', 'fpsCap']);
const parse = (k, v) => k === 'tod' ? (v === 'live' ? 'live' : +v) : NUM.has(k) ? +v : v;

/* ---------- row builders ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const label = (t, hint, k) => `<div class=ol><b>${t}${k in RELOAD ? `<i class=orl>${PK.includes(k) ? 'applies on reload' : 'reloads'}</i>` : ''}</b>${hint ? `<small>${hint}</small>` : ''}</div>`;
const cls = (c, k, off) => `oi ${c}${PK.includes(k) ? ' pend' : ''}${off ? ' off' : ''}`;
const sw = (k, t, hint, off) => `<div class="${cls('', k, off)}">${label(t, hint, k)}<button class=osw role=switch aria-label="${t}" aria-checked=${!!cfg[k]} data-sw=${k}${off ? ' disabled' : ''}><i></i></button></div>`;
const seg = (k, t, hint, opts, cur, off) => `<div class="${cls('s', k, off)}">${label(t, hint, k)}<div class=oseg role=radiogroup aria-label="${t}">${opts.map(([v, l, dis]) => `<button role=radio aria-checked=${String(v) === String(cur)} data-sg=${k} data-v="${v}"${off || dis ? ' disabled' : ''}>${l}</button>`).join('')}</div></div>`;
const slider = (k, t, hint, off) => {
  const d = SL[k], v = d.get();
  return `<div class="${cls('v', k, off)}"><div class=oh>${label(t, hint, k)}<output>${d.fmt(v)}</output></div><input class=osl type=range data-sl=${k} min=${d.min} max=${d.max} step=1 value=${v} aria-label="${t}" style="--p:${(v - d.min) / (d.max - d.min) * 100}%"${off ? ' disabled' : ''}></div>`;
};
const sec = t => `<div class=sec>${t}</div>`;

/* ---------- tabs ---------- */
function tGfx() {
  const Q = QUALITY[cfg.gfx] || QUALITY.med, lowQ = cfg.gfx === 'low', live = O.live && O.aa;
  const run = live && O.aa.mode === cfg.aa ? O.aa : null; // what is really running, once it matches what is picked
  const p = presetOf(), gpuOff = O.live && !O.gpu;
  return sec('PRESET') +
    seg('preset', 'Graphics preset', 'Sets quality, anti-aliasing, sky lighting and auto resolution together.', [...PRESETS.map(([id, l]) => [id, l]), ...(p === 'custom' ? [['custom', 'Custom', 1]] : [])], p) +
    seg('gfx', 'Quality', `${Q.fog} m draw distance · ${Q.shadow ? Q.shadow + ' px shadows' : 'no shadows'} · ${Q.lite ? 'simple' : 'PBR'} materials`, GFX, cfg.gfx || 'med') +
    seg('aa', 'Anti-aliasing', AAH[cfg.aa] + (cfg.aa === 'msaa2' && O.live && O.gpu ? ' WebGPU only does 4× samples, so this runs as 4×.' : ''), Object.entries(AA_MODES).map(([id, m]) => [id, m.l]), cfg.aa) +
    (run && run.why ? `<p class=owarn>${esc(run.label)} is running: ${esc(run.why)}.</p>` : '') +
    sec('RESOLUTION AND FRAME RATE') +
    sw('autoRes', 'Auto resolution', 'Lowers the resolution when the game cannot hold the frame rate, and raises it again when it can.') +
    seg('retro', 'Retro resolution', 'Renders at a low resolution and upscales with crisp pixels. A big speed-up on slow phones.', RES, cfg.retro || 0) +
    seg('fpsCap', 'Frame rate cap', 'A steady 60 looks smoother than a wobbly 120.', FPS, cfg.fpsCap ?? 60) +
    sec('LOOK') +
    sw('ibl', 'Sky lighting and reflections', lowQ ? 'Needs Medium or High quality.' : 'Ambient light and reflections that follow the sky and the time of day.', lowQ) +
    sw('grade', 'Colour grading', 'Warm highlights, cool shadows, a soft contrast curve and a light vignette.') +
    sw('nightFx', 'Night vision', 'Dim areas lose their colour at night, as they do to your eyes.') +
    sw('n64', 'N64 colour filter', '15-bit colour with an ordered dither, like the N64 framebuffer.') +
    sw('mblur', 'Motion blur', 'Speed blur when you ride fast, like GTA San Andreas: it fades in from 60 km/h and is full at 130. Costs nothing below that.') +
    slider('mbAmt', 'Motion blur strength', 'How long the shutter stays open: longer streaks at the same speed.', !cfg.mblur) +
    sec('ADVANCED') +
    sw('gpuCull', 'GPU culling', gpuOff ? 'WebGPU only (this session runs WebGL 2).' : 'Hides off-screen props on the GPU. WebGPU only.', gpuOff) +
    sw('forceGL', 'Force WebGL', 'Use WebGL 2 even where WebGPU works. Try it if the game glitches or crashes.');
}
const tCtl = () => sec('TOUCH') +
  slider('sens', 'Steering sensitivity', 'How far the handlebar turns for a drag of the thumb.') +
  slider('ui', 'Control size', 'Scales the on-screen buttons and grips.') +
  sw('lefty', 'Left-handed layout', 'Mirrors the touch controls.') +
  sw('analogBrk', 'Analog brake', 'A light press is a soft squeeze; drag down for more.') +
  sec('CAMERA') +
  slider('fov', 'Field of view', 'Wider shows more road but feels faster and stretches the edges.');
const tAud = () => sec('SOUND') +
  sw('sound', 'Sound', 'Engine, effects and ambience.') +
  sw('amb', 'Ambient sounds', 'Surf, wind, wildlife and town noise by location.', !cfg.sound) +
  slider('vol', 'Volume', '', !cfg.sound);
const tGame = () => sec('WORLD') +
  seg('tod', 'Time of day', 'Live follows the clock in the Philippines.', TOD, cfg.tod ?? 'live') +
  sec('RIDING') +
  sw('tough', 'Tough Biker mode', 'No falls: walls only stop you, and flips and hard landings are survived.') +
  sw('wc', 'Wheelie control', 'The ECU trims torque near the lift point. Turn it off to wheelie.') +
  sec('SCREEN') +
  sw('showFps', 'Show FPS', 'Frame rate, physics time and the hitch meter.') +
  sw('showApi', 'Show renderer', 'Which renderer is running, in the corner.');
const tSys = () => {
  const aa = O.live && O.aa ? ' · Anti-aliasing: ' + O.aa.label : '';
  return sec('THIS DEVICE') + `<p class=onote>${esc((O.api || 'The renderer is picked when the game loads') + aa)}<br>Build ${esc(BUILD)}</p>` +
    sec('ERROR LOG') + `<pre id=oLog>${esc(LOG.length ? LOG.slice(-12).join('\n') : 'No errors logged')}</pre>` +
    `<div class=obtns><button class=b data-act=copy>Copy log</button><button class="b${rstT ? ' on' : ''}" data-act=reset>${rstT ? 'Tap again to reset everything' : 'Reset all options'}</button></div>` +
    `<p class=onote>Resets the settings in this panel only. Your bikes, garage setups and multiplayer name stay.</p>`;
};
const TABS = [['gfx', 'Graphics', tGfx], ['ctl', 'Controls', tCtl], ['aud', 'Audio', tAud], ['game', 'Game', tGame], ['sys', 'System', tSys]];
let tab = 'gfx'; try { tab = sessionStorage.getItem('cpmOptTab') || tab; } catch (e) { }
if (!TABS.some(t => t[0] === tab)) tab = 'gfx';

/* ---------- render ---------- */
function build(keep) {
  PK = pending(); const body = $('oBody'), y = keep ? body.scrollTop : 0;
  $('oTabs').innerHTML = TABS.map(([id, l]) => `<button role=tab id=ot_${id} aria-selected=${id === tab} tabindex=${id === tab ? 0 : -1} aria-controls=oBody data-tab=${id}>${l}</button>`).join('');
  body.innerHTML = TABS.find(t => t[0] === tab)[2](); body.setAttribute('aria-labelledby', 'ot_' + tab); body.scrollTop = y;
  const t = $('oTabs'), s = t.querySelector('[aria-selected=true]'); // narrow portrait: the tab row scrolls, keep the picked tab in view
  if (t.scrollWidth > t.clientWidth) t.scrollLeft = s.getBoundingClientRect().left - t.getBoundingClientRect().left + t.scrollLeft - (t.clientWidth - s.offsetWidth) / 2;
  $('oApply').hidden = !PK.length; $('oApplyT').textContent = PK.length ? 'Reload to apply: ' + PK.map(k => RELOAD[k]).join(', ') : '';
}
function setTab(id) { tab = id; try { sessionStorage.setItem('cpmOptTab', id); } catch (e) { } build(); }
function set(k, v) {
  cfg[k] = v; save();
  if (k === 'lefty') applyUi();
  if (k === 'retro' && O.setDPR) O.setDPR();
  if (!(k in RELOAD) && O.onPerf) O.onPerf();
  build(true);
}
let rstT = 0; // the two-tap "reset everything" confirmation
const KEEP = new Set(['bike', 'name', 'room', 'mpUrl', 'builds']); // not options: the chosen bike, the multiplayer identity, saved builds
function resetAll() {
  if (!rstT) { rstT = setTimeout(() => { rstT = 0; if (ctx.OPT) build(true); }, 3500); build(true); return; }
  clearTimeout(rstT); rstT = 0;
  for (const k of Object.keys(GLOBAL_DEF)) if (!KEEP.has(k)) cfg[k] = GLOBAL_DEF[k];
  save(); applyUi(); if (O.setDPR) O.setDPR(); if (O.onPerf) O.onPerf(); build(true);
}

export function openOpts() { if (ctx.OPT || ctx.GAR) return; $('opts').hidden = false; build(); ctx.OPT = true; document.body.classList.add('opt'); }
export function closeOpts() { if (!ctx.OPT) return; $('opts').hidden = true; ctx.OPT = false; document.body.classList.remove('opt'); }

/* ---------- input ---------- */
$('opts').onclick = e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return; const d = b.dataset;
  if (d.tab) return setTab(d.tab);
  if (d.sw) return set(d.sw, b.getAttribute('aria-checked') !== 'true');
  if (d.sg === 'preset') { Object.assign(cfg, PRESETS.find(p => p[0] === d.v)[2]); save(); return build(true); }
  if (d.sg) return set(d.sg, parse(d.sg, d.v));
  if (d.act === 'reset') return resetAll();
  if (d.act === 'copy') { const t = LOG.join('\n') || 'No errors logged'; const done = ok => { b.textContent = ok ? 'Copied' : 'Copy failed'; }; try { navigator.clipboard.writeText(t).then(() => done(true), () => done(false)); } catch (x) { done(false); } return; }
  if (b.id === 'oReload') location.reload();
};
$('opts').oninput = e => {
  const el = e.target.closest('input[data-sl]'); if (!el) return; const d = SL[el.dataset.sl], v = +el.value;
  d.set(v); save(); el.style.setProperty('--p', (v - d.min) / (d.max - d.min) * 100 + '%'); el.closest('.oi').querySelector('output').textContent = d.fmt(v);
};
// arrow keys move between tabs (the tab list is one tab stop)
$('oTabs').onkeydown = e => {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return; e.preventDefault();
  setTab(TABS[(TABS.findIndex(t => t[0] === tab) + d + TABS.length) % TABS.length][0]); $('oTabs').querySelector('[aria-selected=true]').focus();
};
$('oClose').onclick = closeOpts; $('bOpt').onclick = openOpts;
