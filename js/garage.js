// Garage: the bike on a pedestal in the studio (studio.js). Tabs of parts, sliders and assists generated from the bike's data
// file, each option showing what it changes; live stats against stock, a dyno curve with the revving engine on it, saved builds
// and JSON export / import. Nothing here touches physics: it edits ctx.bcfg and main.js recomputes the spec.
import { $, lerpTable } from './util.js';
import { ctx, S } from './state.js';
import { cfg, save } from './config.js';
import { computeSpec, tq } from './spec.js';
import { DRIVES } from './drivetrain.js';
import { say } from './hud.js';
import { TC } from './controls.js';
import { view, accent, pulse, reframe } from './studio.js';
import { bikeCard } from './bikecard.js';
import { dynoRun, dynoGear, DRUM } from './dyno.js';
import { tuneRead, sliderOn, jetOf } from './tune.js';

export const G = { onBike: null, onChange: null };   // set by main.js
const GAME = 'cpm-motor-edition', $$ = s => document.querySelectorAll(s), esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

// [id, label, camera preset]: close-ups per area, the overview tabs keep turning
const TABS = [
  ['engine', 'ENGINE', { az: 1.2, el: .12, r: 2.3, ty: .5, tz: .05 }], ['drive', 'DRIVETRAIN', { az: 1.25, el: .1, r: 2.4, ty: .45, tz: -.15 }],
  ['susp', 'SUSPENSION', { az: .9, el: .1, r: 2.6, ty: .55, tz: .55 }], ['wheels', 'WHEELS & BRAKES', { az: 1.4, el: .08, r: 2.3, ty: .35, tz: .5 }],
  ['style', 'ACCESSORIES', { az: 2.5, el: .3, r: 3.1, ty: .8, tz: .1 }], ['lights', 'LIGHTS', { az: .75, el: .14, r: 3.1, ty: .45, tz: 0 }],
  ['look', 'PAINT', { spin: 1, el: .2, r: 3.6, ty: .7, tz: 0 }], ['carbon', 'CARBON', { spin: 1, el: .18, r: 3.3, ty: .7, tz: 0 }],
  ['stats', 'STATS', { spin: 1, el: .2, r: 3.8, ty: .65, tz: 0 }], ['dyno', 'DYNO', { az: 1.5, el: .06, r: 2.7, ty: .4, tz: -.45 }], ['builds', 'BUILDS', { spin: 1, el: .2, r: 3.8, ty: .65, tz: 0 }],
];
const WHERE = { swarm: 'susp', exhaust: 'engine', ecu: 'engine', fuelsys: 'engine', tune: 'engine', trim: 'wheels', intake: 'engine', flywheel: 'engine', rollers: 'drive', cspring: 'drive', clspring: 'drive', pulley: 'drive', fs: 'drive', rs: 'drive', autoClutch: 'drive', iss: 'drive', qs: 'drive', tc: 'drive', ver: 'drive', ysp: 'drive', kit: 'engine', frame: 'look', decal: 'look', tb: 'engine', injector: 'engine', carb: 'engine', valves: 'engine', port: 'engine', cyl: 'engine', piston: 'engine', oil: 'engine', coil: 'engine', cdi: 'engine', plug: 'engine', cam: 'engine', battery: 'engine', clutch: 'drive', chain: 'drive', belt: 'drive', lines: 'wheels',
  rims: 'wheels', disc: 'wheels', caliper: 'wheels', mirrors: 'style', levers: 'style', grips: 'style', seat: 'style', box: 'style', hl: 'lights', aux: 'lights', glow: 'lights', wled: 'lights',
  pf: 'susp', pr: 'susp', yf: 'susp', yr: 'susp', kf: 'susp', kr: 'susp', damp: 'susp', tires: 'wheels', brakes: 'wheels', wheelcol: 'wheels', rimstripe: 'wheels',
  fl: 'dyno', fm: 'dyno', fh: 'dyno', il: 'dyno', ih: 'dyno', ig: 'dyno', ct: 'dyno', idl: 'dyno', rl: 'dyno', mj: 'dyno', nc: 'dyno', ps: 'dyno' }; // fine tuning (tune.js)
const where = k => WHERE[k] || (k.startsWith('cf') ? 'carbon' : 'look');
const has = t => t === 'look' || t === 'dyno' || t === 'wheels' || t === 'stats' || t === 'builds' || Object.keys(ctx.bike.parts).some(k => where(k) === t) || ctx.bike.sliders.some(s => where(s.k) === t) || ctx.bike.toggles.some(s => where(s.k) === t);
let tab = 'engine', sId = '', sSpec = null;
const stock = () => (sId !== ctx.bike.id && (sSpec = computeSpec(ctx.bike, ctx.bike.defaults), sId = ctx.bike.id), sSpec);

/* ---------- numbers ---------- */
// engine power at an rpm (PS) from the torque table; peak up to the redline
const pAt = (s, r) => tq(s, r) * r * s.pow / 7023.5, tAt = (s, r) => tq(s, r) * s.pow;
function pk(s) { let b = 0, r = 0; for (let x = 1000; x <= s.red; x += 100) { const p = pAt(s, x); if (p > b) { b = p; r = x; } } return [b, r]; }
// label, unit, value, decimals, which way is better (1 up, -1 down, 0 neutral), bar scale (full bar = scale × stock)
const ROWS = [
  ['Power', 'PS', s => pk(s)[0], 1, 1, 1.6], ['Weight', 'kg', s => s.m, 1, -1, 1.4], ['Power / weight', 'PS/t', s => pk(s)[0] / s.m * 1000, 0, 1, 1.6],
  ['Top speed', 'km/h', s => DRIVES[s.type].top(s), 0, 1, 1.4], ['Redline', 'rpm', s => s.red, 0, 1, 1.3],
  ['Grip · max lean', '°', s => Math.atan(s.mu * .9) * 57.3, 0, 1, 1.3], ['Braking', 'g', s => s.mu * s.brake, 2, 1, 1.6], ['Static sag', 'cm', s => s.sag * 100, 1, 0, 2],
];
function statsHTML() {
  const s = ctx.spec, o = stock(); let h = '';
  for (const [l, u, f, dp, dir, sc] of ROWS) {
    const v = f(s), v0 = f(o), d = +(v - v0).toFixed(dp), cls = !d ? '' : !dir ? 'nu' : d * dir > 0 ? 'up' : 'dn';
    h += `<div class=st><span>${l}</span><b>${v.toFixed(dp)} <small>${u}</small>${d ? ` <em class=${cls}>${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(dp)}</em>` : ''}</b><div class=bar><u style="width:${Math.min(100, v / (v0 * sc) * 100).toFixed(1)}%"></u><s style="left:${(100 / sc).toFixed(1)}%"></s></div></div>`;
  }
  return h + `<canvas class=dyno width=380 height=170></canvas><details><summary>Drivetrain details</summary><div class=det>${ctx.drive.stats(s, ctx.bcfg)}</div></details>`;
}
let sHtml = '';
function stats() {
  const h = statsHTML(); if (h !== sHtml) { sHtml = h; for (const e of $$('.statbox')) e.innerHTML = h; }
  for (const c of $$('canvas.dyno')) dyno(c);
}
// dyno chart: stock (dashed) against this build, power (amber) and torque (blue), redline, and the live engine as a dot
function dyno(c) {
  const g = c.getContext('2d'), W = c.width, H = c.height, s = ctx.spec, o = stock(), x0 = 24, xm = Math.max(s.red, o.red) * 1.08, pm = Math.max(pk(s)[0], pk(o)[0]) * 1.12, tm = Math.max(s.tqMax * s.pow, o.tqMax) * 1.12;
  const X = r => x0 + r / xm * (W - x0 - 8), Y = (v, m) => H - 22 - v / m * (H - 38);
  g.clearRect(0, 0, W, H); g.font = '11px system-ui'; g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.08)'; g.fillStyle = '#7d8893';
  for (let r = 0; r <= xm; r += 2000) { g.beginPath(); g.moveTo(X(r), 12); g.lineTo(X(r), H - 22); g.stroke(); g.fillText(r / 1000 + 'k', X(r) - 5, H - 8); }
  const curve = (sp, f, m, col, w, dash) => { g.beginPath(); for (let r = 0; r <= sp.red; r += 100) { const y = Y(f(sp, r), m); r ? g.lineTo(X(r), y) : g.moveTo(X(r), y); } g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = w; g.stroke(); g.setLineDash([]); };
  curve(o, tAt, tm, 'rgba(94,200,255,.4)', 1.5, [4, 4]); curve(o, pAt, pm, 'rgba(255,176,32,.4)', 1.5, [4, 4]); curve(s, tAt, tm, '#5ec8ff', 2, []); curve(s, pAt, pm, '#ffb020', 2.5, []);
  g.strokeStyle = 'rgba(255,74,61,.75)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(s.red), 12); g.lineTo(X(s.red), H - 22); g.stroke();
  if (S.running) { const r = Math.min(S.rpm, s.red); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(r), 12); g.lineTo(X(r), H - 22); g.stroke(); g.fillStyle = '#fff'; g.beginPath(); g.arc(X(r), Y(pAt(s, r), pm), 4.5, 0, 6.3); g.fill(); }
  const [p, pr] = pk(s); g.fillStyle = '#ffb020'; g.fillText(`${p.toFixed(1)} PS @ ${pr}`, x0 + 4, 11); g.fillStyle = '#5ec8ff'; g.fillText(`${(s.tqMax * s.pow).toFixed(1)} Nm`, W - 60, 11);
}
let gt = 0;
export function garageFrame() { // each frame while the garage is open: live readout + dyno dot + a dyno run playing
  const t = performance.now(); if (play) dynoTick(t); if (t - gt < 50) return; gt = t; const s = ctx.spec, r = S.rpm;
  $('gRpm').textContent = S.running ? `${Math.round(r / 10) * 10} rpm · ${pAt(s, Math.min(r, s.red)).toFixed(1)} PS` : 'ENGINE OFF · hold REV';
  for (const c of $$('canvas.dyno')) if (c.offsetParent) dyno(c);
}

/* ---------- tabs ---------- */
// what choosing option i of part k would change, against what is fitted now
function delta(k, i) {
  const a = ctx.spec, s = computeSpec(ctx.bike, { ...ctx.bcfg, [k]: i }), o = [];
  const d = (v, fmt, good) => { if (v) o.push(`<em class=${!good ? 'nu' : v * good > 0 ? 'up' : 'dn'}>${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}</em>`); };
  d(Math.round((pk(s)[0] - pk(a)[0]) * 10) / 10, v => v.toFixed(1) + ' PS', 1); d(Math.round((s.m - a.m) * 10) / 10, v => v.toFixed(1) + ' kg', -1);
  d(Math.round((s.mu / a.mu - 1) * 100), v => v + '% grip', 1); d(Math.round((s.brake / a.brake - 1) * 100), v => v + '% braking', 1);
  d(Math.round((s.red - a.red) / 50) * 50, v => v + ' rpm limit', 1); d(Math.round((s.ie / a.ie - 1) * 100), v => v + '% flywheel', 0);
  d(Math.round(DRIVES[s.type].top(s) - DRIVES[a.type].top(a)), v => v + ' km/h top', 1);
  d(Math.round((s.roll / a.roll - 1) * 100), v => v + '% rolling drag', -1); d(Math.round((s.drag / a.drag - 1) * 1000) / 10, v => v + '% air drag', -1);
  if (s.offr !== a.offr) o.push(`<em class=${s.offr ? 'up' : 'dn'}>${s.offr ? '+' : '−'}off-road grip</em>`);
  d(Math.round((s.cap / a.cap - 1) * 100), v => v + '% clutch hold', 1); d(Math.round((s.eta / a.eta - 1) * 1000) / 10, v => v + '% drive efficiency', 1);
  if (s.slipper !== a.slipper) o.push(`<em class=${s.slipper ? 'up' : 'dn'}>${s.slipper ? '+slipper clutch' : '−slipper clutch'}</em>`);
  return o.slice(0, 3).join(' ');
}
// Sub-menus (ENGINE, WHEELS & BRAKES): the parts grouped the way a workshop would (key -> group; unknown engine keys land in ECU
// & tuning, unknown wheel keys in RIMS). The last entry of a wheels group is its close-up camera.
const SUBS = [['intake', 'INTAKE & FUEL', 'Air in and fuel in: filter, throttle body or carburettor, injector.'], ['head', 'HEAD', 'Camshaft, valve springs and port work: how well the engine breathes up high.'],
  ['bottom', 'BOTTOM END', 'Cylinder, piston, flywheel and oil: displacement, compression, rotating mass, friction.'], ['ign', 'IGNITION', 'Spark plug, coil, CDI and battery.'],
  ['exh', 'EXHAUST', 'Pipe and silencer.'], ['ecu', 'ECU & TUNING', 'Fuel and ignition map, rev limit, power modes and kits.']];
const WSUBS = [['tires', 'TIRES', 'Sizes that fit this bike\'s rims. Grip, weight and rolling drag change, and so does how the bike sits on its wheels.', { az: 1.05, el: .1, r: 2.7, ty: .4, tz: .1 }],
  ['rims', 'RIMS', 'Wheel design, colour and rim tape.', { az: 1.5, el: .05, r: 2.6, ty: .38, tz: .1 }], ['brakes', 'BRAKES', 'Discs, calipers, pads and lines.', { az: 1.3, el: .06, r: 1.9, ty: .32, tz: -.55 }]];
const SUBL = { engine: SUBS, wheels: WSUBS }, SUBDEF = { engine: 'ecu', wheels: 'rims' };
const SUBOF = { intake: 'intake', tb: 'intake', carb: 'intake', injector: 'intake', fuelsys: 'intake', cam: 'head', valves: 'head', port: 'head', cyl: 'bottom', piston: 'bottom', oil: 'bottom', flywheel: 'bottom', tune: 'bottom', plug: 'ign', coil: 'ign', cdi: 'ign', battery: 'ign', exhaust: 'exh', ecu: 'ecu', kit: 'ecu',
  tires: 'tires', rims: 'rims', wheelcol: 'rims', rimstripe: 'rims', brakes: 'brakes', lines: 'brakes', disc: 'brakes', caliper: 'brakes', trim: 'brakes' };
const subOf = (k, t = 'engine') => SUBOF[k] || SUBDEF[t];
const FIRST = new Set(['disc', 'caliper', 'rims']); // the parts you can see lead their group
const subSel = { engine: 'intake', wheels: 'tires' };
function subHTML(bike, b, t) {
  const ks = Object.keys(bike.parts).filter(k => where(k) === t), subs = SUBL[t].filter(x => ks.some(k => subOf(k, t) === x[0]));
  if (!subs.some(x => x[0] === subSel[t])) subSel[t] = subs[0][0];
  return `<div class=gsub>${subs.map(([id, l]) => { const n = ks.filter(k => subOf(k, t) === id && b[k] !== bike.defaults[k]).length; return `<button class="gs${id === subSel[t] ? ' on' : ''}" data-sub=${id}>${l}${n ? `<i>${n}</i>` : ''}</button>`; }).join('')}</div><p class=gsubd>${SUBL[t].find(x => x[0] === subSel[t])[2]}</p>`;
}
// colour chip of an option (paint, wheels, tape, covers, calipers, levers, grips, seat, sidewall, bag, bulbs, LEDs; 'rgb' = the cycling controller)
const swatch = o => { const c = o.c || o.wc || o.rim || o.ec || o.hd || o.calC || o.levC || o.grpC || o.seatC || o.boxC || o.tyS || o.hlC || o.auxC || o.glowC || o.wledC; return c === 'rgb' ? 'conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' : c; };
// a slider's value as shown: signed offsets get their +, the main jet shows the jet's real size
const sval = (s, v) => s.f === 'jet' ? '#' + jetOf(ctx.bike, ctx.spec, v - ctx.bike.defaults[s.k])[0] : (s.sg && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + s.u;
const sliderHTML = (s, b, def) => `<div class=pr><div class=pl>${s.l} <b id=v_${s.k}>${sval(s, b[s.k])}</b>${b[s.k] !== def[s.k] ? `<small> stock ${sval(s, def[s.k])}</small>` : ''}</div><input type=range min=${s.min} max=${s.max} step=${s.step || 1} value=${b[s.k]} data-s=${s.k}></div>`;
const hex = v => /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888';
function body(keep) {
  const bike = ctx.bike, b = ctx.bcfg, def = bike.defaults; let h = '';
  if (tab === 'stats') h = '<div class=statbox></div>';
  else if (tab === 'builds') h = buildsHTML();
  else if (tab === 'dyno') h = dynoHTML();
  else {
    const sb = SUBL[tab] && subHTML(bike, b, tab); if (sb) h += sb;
    for (const [k, p] of Object.entries(bike.parts).sort((x, y) => FIRST.has(y[0]) - FIRST.has(x[0]))) if (where(k) === tab && (!sb || subOf(k, tab) === subSel[tab])) {
      h += `<div class=pr><div class=pl>${p.l}</div><div class=opts>${p.o.map((o, i) => { const sw = swatch(o), nt = o.note ? esc(o.note) : '', on = b[k] == i; return `<button class="opt${on ? ' on' : ''}${sw ? ' sw' : ''}" data-k=${k} data-i=${i}>${sw ? `<i class=dot style="background:${sw}"></i>` : ''}<b>${o.n}</b><small>${on ? 'fitted' + (nt ? ' · ' + nt : '') : [nt, delta(k, i)].filter(Boolean).join(' ')}</small></button>`; }).join('')}</div></div>`;
    }
    for (const s of bike.sliders) if (where(s.k) === tab) h += sliderHTML(s, b, def);
    const tg = bike.toggles.filter(s => where(s.k) === tab);
    if (tg.length) h += `<div class=pr><div class=pl>Assists</div><div class=chips>${tg.map(t => `<button class="chip${b[t.k] ? ' on' : ''}" data-t=${t.k}>${t.l}</button>`).join('')}</div></div>`;
    if (tab === 'look' || (tab === 'wheels' && subSel.wheels === 'rims')) { const k = tab === 'look' ? 'cc' : 'cw'; h += `<div class=pr><div class=pl>Custom ${tab === 'look' ? 'body' : 'wheel'} colour</div><div class=crow><input type=color data-cc=${k} value="${hex(b[k] || (tab === 'look' ? ctx.spec.c : ctx.spec.wc))}"><button class=chip data-clr=${k}>Clear</button></div></div>`; }
    h += `<div class=pr><button class="chip" data-treset=1>↺ Reset ${TABS.find(t => t[0] === tab)[1].toLowerCase()} to stock</button></div>`;
  }
  $('gBody').innerHTML = h; if (!keep) $('gBody').scrollTop = 0; if (tab === 'stats') { sHtml = ''; stats(); } if (tab === 'dyno') drawDyno();
}
function tabs() { $('gTabs').innerHTML = TABS.filter(t => has(t[0])).map(t => `<button class="gt gt-${t[0]}${t[0] === tab ? ' on' : ''}" data-tab=${t[0]}>${t[1]}</button>`).join(''); }
const camOf = t => (t === 'wheels' && WSUBS.find(x => x[0] === subSel.wheels) || TABS.find(x => x[0] === t))[t === 'wheels' ? 3 : 2];
function setTab(t) { tab = t; tabs(); body(); reframe(); view(camOf(t)); }

export function buildGarage() {
  if (!has(tab)) tab = 'engine'; if (play) endRun(false);
  $('gBikes').innerHTML = Object.values(ctx.bikes).map(k => bikeCard(k, k.id === ctx.bike.id, 'data-bike')).join('');
  $('gCurN').textContent = ctx.bike.short; $('gName').textContent = ctx.bike.tag; list(false); reframe(); accent(ctx.spec.c); setTab(tab); stats();
}
// stock / colour-only: keys that belong to a tab (parts, sliders, assists, custom colours)
const tabKeys = t => [...Object.keys(ctx.bike.parts), ...ctx.bike.sliders.map(s => s.k), ...ctx.bike.toggles.map(s => s.k)].filter(k => where(k) === t).concat(t === 'look' ? ['cc'] : t === 'wheels' ? ['cw'] : []);
function changed(p = true) { save(); G.onChange(); reframe(); accent(ctx.spec.c); if (p) pulse(); stats(); }

// bike picker: ‹ › step through the list, the name opens a grid of cards (tap outside or the name again to close)
function list(v) { $('gList').hidden = !v; $('gCur').classList.toggle('on', v); if (v) { const on = $('gBikes').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' }); } }
function pick(id) { list(false); if (id !== ctx.bike.id) { cfg.bike = id; save(); G.onBike(); buildGarage(); } }
$('garage').onclick = e => {
  const el = e.target.closest('button'); if (!$('gList').hidden && !e.target.closest('#gList,#gCur')) list(false); if (!el) return; const d = el.dataset, b = ctx.bcfg;
  if (el.id === 'gCur') list($('gList').hidden);
  else if (d.step) { const L = Object.keys(ctx.bikes), i = L.indexOf(ctx.bike.id); pick(L[(i + +d.step + L.length) % L.length]); }
  else if (d.bike) pick(d.bike);
  else if (d.tab) setTab(d.tab);
  else if (d.sub) { subSel[tab] = d.sub; body(); if (tab === 'wheels') view(camOf(tab)); }
  else if (d.dy) dynoAct(d.dy, +d.i);
  else if (d.k) { b[d.k] = +d.i; changed(); body(1); }
  else if (d.t) { b[d.t] = !b[d.t]; el.classList.toggle('on', b[d.t]); changed(false); }
  else if (d.clr) { delete b[d.clr]; changed(); body(1); }
  else if (d.treset) { for (const k of tabKeys(tab)) if (k in ctx.bike.defaults) b[k] = ctx.bike.defaults[k]; else delete b[k]; changed(); body(1); }
  else if (d.act) act(+d.act, +d.i);
};
$('garage').oninput = e => {
  const d = e.target.dataset, b = ctx.bcfg;
  if (d.s) { b[d.s] = +e.target.value; changed(false); $('v_' + d.s).textContent = sval(ctx.bike.sliders.find(x => x.k === d.s), b[d.s]); if (tab === 'dyno') tuneLive(); }
  else if (d.cc) { b[d.cc] = e.target.value; changed(false); }
};
// RESET TO STOCK: two taps (the first arms it) so a stray tap can't wipe a build
$('gStock').onclick = () => {
  const el = $('gStock'), idle = () => { el.classList.remove('on'); el.textContent = 'RESET TO STOCK'; }; clearTimeout(el.t);
  if (!el.classList.contains('on')) { el.classList.add('on'); el.textContent = 'TAP AGAIN TO RESET'; el.t = setTimeout(idle, 2500); return; }
  idle(); delete ctx.bcfg.cc; delete ctx.bcfg.cw; Object.assign(ctx.bcfg, ctx.bike.defaults); changed(); body(1); say('Back to stock', 1000);
};

/* ---------- dyno run (js/dyno.js does the physics; here: gear pick, playback with the real engine sound, chart, results) ---------- */
// Runs are kept per bike for this session (up to 5, oldest dropped), plus an optional stock pull drawn as a grey ghost.
const RUNS = {}, DCOL = ['#ffb020', '#5ec8ff', '#7be08a', '#ff6b8a', '#c49bff'], ORD = n => n + ([, 'st', 'nd', 'rd'][n] || 'th');
let dGear = 0, dBike = '', play = null;
const runs = () => RUNS[ctx.bike.id] || (RUNS[ctx.bike.id] = Object.assign([], { n: 0, stock: null }));
const fmt = v => Math.round(v).toLocaleString('en-US'), r50 = v => fmt(Math.round(v / 50) * 50);
function dGearNow() { if (dBike !== ctx.bike.id) { dBike = ctx.bike.id; dGear = ctx.spec.type === 'cvt' ? 0 : dynoGear(ctx.spec); } return Math.min(dGear, ctx.spec.nG || 0); }
// what is fitted that isn't stock (engine + drivetrain), for the run's label
function buildName() {
  const bike = ctx.bike, b = ctx.bcfg, def = bike.defaults, L = [];
  for (const [k, p] of Object.entries(bike.parts)) if ((where(k) === 'engine' || where(k) === 'drive') && b[k] !== def[k] && p.o[b[k]]) L.push(p.o[b[k]].n.replace(/\s*\(.*\)/, ''));
  for (const s of bike.sliders) if (where(s.k) === 'drive' && b[s.k] !== def[s.k]) L.push(`${s.l} ${b[s.k]}${s.u}`);
  if (ctx.spec.tuned) L.push('fine-tuned');
  return L.length ? L.join(', ') : 'Stock engine';
}
// ---- fine tuning (js/tune.js): the sliders a tuner works with the bike on the drum, the wideband reading and the knock ears ----
const TGRP = { fl: ['Fuel', 'Per cent more or less fuel than the fitted map, in three rev bands. Best power sits near 13.0 : 1; leaner saves fuel and crackles on the overrun, far too lean loses power fast. Freer-breathing parts need more fuel.'],
  mj: ['Carburettor', 'Main jet feeds the top end, the needle clip the mid range, the screw idle and low revs. Best power sits near 13.0 : 1. A freer pipe or filter needs bigger jets.'],
  il: ['Ignition', 'Degrees of spark advance against stock. A little more usually finds power; too much and the engine pings (knock), sooner with high compression or a lean mixture.'], ig: ['Ignition', 'The pickup plate turns the whole spark curve. A little advance usually finds power; too much and the engine pings (knock), sooner with high compression or a lean mixture.'],
  ct: ['Cam timing', 'Slotted cam sprocket, crank degrees. Advanced fills in the bottom end, retarded moves the power up the revs.'], idl: ['Idle and limiter', 'Idle speed, and where the rev limiter cuts in.'] };
const AFRC = v => v > 13.45 ? 'dn' : v < 12.55 ? 'nu' : 'up';
function tuneLine() {
  const r = tuneRead(ctx.bike, ctx.spec, ctx.bcfg); if (!r) return '';
  const k = r.knock, kn = Math.max(...k), wh = k[0] > 0 && k[2] > 0 ? 'right through the revs' : k[2] > 0 ? 'at the top end' : k[0] > 0 ? 'at low revs' : 'in the mid range';
  return `Wideband AFR · ${['low', 'mid', 'top'].map((l, i) => `${l} <em class=${AFRC(r.afr[i])}>${r.afr[i].toFixed(1)}</em>`).join(' · ')} <small>(best power 12.8–13.2)</small><br>Knock: ${kn > 0 ? `<em class=dn>${kn > 2 ? 'heavy' : 'light'} pinging ${wh}</em>` : '<em class=up>none</em>'} · crank peak <b>${pk(ctx.spec)[0].toFixed(1)} PS</b>`;
}
function tuneLive() { const e = $('dTune'); if (e) e.innerHTML = tuneLine(); }
function tuneHTML() {
  const bike = ctx.bike, b = ctx.bcfg, sl = bike.sliders.filter(s => where(s.k) === 'dyno' && sliderOn(s, ctx.spec)); if (!sl.length) return '';
  let h = `<div class=pr><div class=pl>Fine tuning</div><p>Optional: what a tuner adjusts with the bike on the drum. Stock is safe everywhere; change something, RUN again and compare.</p><div class=dlive id=dTune>${tuneLine()}</div></div>`;
  for (const s of sl) { const g = TGRP[s.k]; if (g) h += `<div class=pr><div class=pl>${g[0]}</div><p>${g[1]}</p></div>`; h += sliderHTML(s, b, bike.defaults); }
  return h + `<div class=pr><button class=chip data-treset=1>↺ Reset fine tuning to stock</button></div>`;
}
function dynoHTML() {
  const s = ctx.spec, g = dGearNow(), L = runs(), busy = !!play;
  const gears = s.type === 'cvt' ? `<p>CVT: the variator shifts by itself through the pull, so the chart runs against road speed.</p>`
    : `<div class=crow>${Array.from({ length: s.nG }, (_, i) => i + 1).map(i => `<button class="chip${i === g ? ' on' : ''}" data-dy=gear data-i=${i}>${ORD(i)}</button>`).join('')}</div>`;
  const best = L[0] ? L[0].r.hp : 0;
  const row = (x, col, label) => `<tr><td><i style="background:${col}"></i>${label}</td><td><b>${x.r.hp.toFixed(1)}</b></td><td>${r50(x.r.hpRpm)}</td><td><b>${x.r.tq.toFixed(1)}</b></td><td>${r50(x.r.tqRpm)}</td><td>${Math.round(x.r.loss * 100)}%</td><td>${x === L[0] || !best ? '' : `<em class=${x.r.hp >= best ? 'up' : 'dn'}>${x.r.hp >= best ? '+' : '−'}${Math.abs(x.r.hp - best).toFixed(1)}</em>`}</td></tr><tr class=bn><td colspan=7>${esc(x.name)} · ${x.r.cvt ? 'CVT' : ORD(x.r.gear) + ' gear'} · ${x.r.kphEnd.toFixed(0)} km/h at the limiter${x.tn ? ` · AFR ${x.tn.afr.map(v => v.toFixed(1)).join(' / ')}${Math.max(...x.tn.knock) > 0 ? ' · <em class=dn>knock</em>' : ''}` : ''}</td></tr>`;
  const tbl = L.length || L.stock ? `<table class=dres><tr><th></th><th>Wheel PS</th><th>rpm</th><th>Nm</th><th>rpm</th><th>Loss</th><th>vs #${L[0] ? L[0].n : ''}</th></tr>${L.stock ? row(L.stock, '#8a929b', 'Stock') : ''}${L.map(x => row(x, x.col, '#' + x.n)).join('')}</table>` : '<p>No runs yet. Fit some parts, then press RUN.</p>';
  return `<div class=pr><div class=pl>Dyno gear</div>${gears}</div>
<div class=pr><div class=crow><button class="chip on" data-dy=run${busy ? ' disabled' : ''}>${busy ? 'RUNNING…' : '▶ RUN'}</button><button class="chip${L.stock ? ' on' : ''}" data-dy=stock${busy ? ' disabled' : ''}>Stock ghost</button><button class=chip data-dy=clear${busy ? ' disabled' : ''}>Clear runs</button></div>
<canvas class=dynor width=400 height=250></canvas><div class=dlive id=dLive>${busy ? '' : `Brochure (crank) peak with this build: <b>${dynoRun(s, ctx.drive, ctx.bcfg, g || 1).crank.toFixed(1)} PS</b>. The drum reads what reaches the rear tyre.`}</div></div>
<div class=pr><div class=pl>Results</div>${tbl}</div>
${busy ? '' : tuneHTML()}<details><summary>How this dyno works</summary><div class=det>An inertia drum (${DRUM} kg at its surface) is spun by the rear tyre at full throttle from low revs to the limiter${s.type === 'cvt' ? ', the CVT shifting as it would on the road' : ' in one gear'}. Power = drum mass × its acceleration × speed, so it shows rear-wheel PS: the chain or belt, gearbox, clutch and the engine's own spinning parts all take their share (Loss = how far below the crank figure). Torque is that power at the engine's rpm. Every fitted part and every fine-tuning setting counts: cams and throttle bodies move the curve up the rev range, oil cuts friction, a light flywheel reads higher here, a heavy one lower. No wind on a dyno, so no ram air.</div></details>`;
}
function dynoAct(a, i) {
  const L = runs(); if (play && a !== 'gear') return;
  if (a === 'gear') { if (play) return; dGear = i; body(1); }
  else if (a === 'clear') { L.length = 0; L.n = 0; L.stock = null; body(1); }
  else if (a === 'stock') { L.stock = L.stock ? null : { r: dynoRun(stock(), ctx.drive, ctx.bike.defaults, dGearNow()), tn: tuneRead(ctx.bike, stock(), ctx.bike.defaults), name: 'Stock', col: '#8a929b' }; body(1); }
  else if (a === 'run') {
    const r = dynoRun(ctx.spec, ctx.drive, ctx.bcfg, dGearNow()), n = ++L.n;
    // the pull plays back in 5-9 s whatever the drum took, with the engine sound following the revs; a short hold on the limiter at the end
    play = { run: { r, n, name: buildName(), tn: tuneRead(ctx.bike, ctx.spec, ctx.bcfg), col: DCOL[(n - 1) % DCOL.length] }, t0: performance.now(), k: r.T / Math.min(9, Math.max(5, r.T)), i: 0, end: 0 };
    TC.rev = 1; $('revB').classList.add('on'); body(1);
  }
}
function endRun(keep) {
  const p = play; play = null; TC.rev = 0; $('revB').classList.remove('on'); if (!p) return;
  if (keep) { const L = runs(); L.push(p.run); if (L.length > 5) L.shift(); say(`Run #${p.run.n}: ${p.run.r.hp.toFixed(1)} PS at the wheel`, 1600); }
  if (tab === 'dyno') body(1);
}
function dynoTick(now) {
  const p = play, P = p.run.r.pts, el = (now - p.t0) / 1000 * p.k;
  if (el >= p.run.r.T) { if (!p.end) p.end = now; S.rpm = ctx.spec.red; if (now - p.end > 450) endRun(true); return; }
  while (p.i < P.length - 1 && P[p.i + 1].t <= el) p.i++;
  const q = P[p.i]; S.rpm = q.rpm; // the engine sound follows the pull (physics free-revs on the stand; this pins the revs to the drum)
  if (tab === 'dyno') { drawDyno(); const e = $('dLive'); if (e) e.innerHTML = `<b>${fmt(q.rpm)}</b> rpm · <b>${q.kph.toFixed(0)}</b> km/h · <b style="color:${p.run.col}">${q.hp.toFixed(1)} PS</b> · ${q.tq.toFixed(1)} Nm`; }
}
// power (solid) and torque (dashed) of every run; x is rpm for geared bikes, km/h for CVTs
function drawDyno() {
  const c = document.querySelector('canvas.dynor'); if (!c) return;
  const g = c.getContext('2d'), W = c.width, H = c.height, L = runs(), all = [...(L.stock ? [L.stock] : []), ...L, ...(play ? [play.run] : [])];
  g.clearRect(0, 0, W, H); g.font = '11px system-ui';
  const cvt = ctx.spec.type === 'cvt', X0 = 30, X1 = W - 30, Y0 = H - 22, Y1 = 18, xv = q => cvt ? q.kph : q.rpm;
  if (!all.length) { g.fillStyle = '#7d8893'; g.fillText('Press RUN to strap the bike to the drum', X0 + 40, H / 2); return; }
  let xa = 1e9, xb = 0, pm = 0, tm = 0; for (const x of all) for (const q of x.r.pts) { xa = Math.min(xa, xv(q)); xb = Math.max(xb, xv(q)); pm = Math.max(pm, q.hp); tm = Math.max(tm, q.tq); }
  const st = cvt ? 20 : xb > 12000 ? 2000 : 1000; xa = Math.floor(xa / st) * st; xb = Math.ceil(xb / st) * st; pm *= 1.15; tm *= 1.15;
  const X = v => X0 + (v - xa) / (xb - xa) * (X1 - X0), YP = v => Y0 - v / pm * (Y0 - Y1), YT = v => Y0 - v / tm * (Y0 - Y1);
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.08)'; g.fillStyle = '#7d8893';
  for (let v = xa; v <= xb + 1e-6; v += st) { g.beginPath(); g.moveTo(X(v), Y1); g.lineTo(X(v), Y0); g.stroke(); g.fillText(cvt ? v : v / 1000 + 'k', X(v) - 6, H - 7); }
  for (let i = 0; i <= 4; i++) { const y = Y0 - i / 4 * (Y0 - Y1); g.beginPath(); g.moveTo(X0, y); g.lineTo(X1, y); g.stroke(); g.fillText((pm * i / 4).toFixed(0), 4, y + 4); g.fillText((tm * i / 4).toFixed(0), X1 + 4, y + 4); }
  g.fillText('PS', 4, 10); g.fillText('Nm', X1 + 4, 10); g.fillText(cvt ? 'km/h' : 'rpm', X1 - 22, Y0 - 4);
  for (const x of all) {
    const live = play && x === play.run, P = live ? x.r.pts.slice(0, play.i + 1) : x.r.pts, ghost = x === L.stock; if (P.length < 2) continue;
    for (const [f, Y, w, dash] of [[q => q.tq, YT, 1.5, [5, 4]], [q => q.hp, YP, ghost ? 1.5 : 2.5, ghost ? [3, 3] : []]]) {
      g.beginPath(); P.forEach((q, j) => j ? g.lineTo(X(xv(q)), Y(f(q))) : g.moveTo(X(xv(q)), Y(f(q)))); g.setLineDash(dash); g.strokeStyle = x.col; g.globalAlpha = ghost ? .7 : dash.length ? .6 : 1; g.lineWidth = w; g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
    if (live) { const q = P[P.length - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(X(xv(q)), YP(q.hp), 4, 0, 6.3); g.fill(); }
    else if (!ghost) { g.fillStyle = x.col; g.beginPath(); g.arc(X(cvt ? x.r.hpKph : x.r.hpRpm), YP(x.r.hp), 3, 0, 6.3); g.fill(); }
  }
  let ly = Y1 + 2; g.textAlign = 'left'; for (const x of all) { g.fillStyle = x.col; g.fillText(`${x === L.stock ? 'Stock' : '#' + x.n} ${(play && x === play.run ? x.r.pts[play.i].hp : x.r.hp).toFixed(1)} PS`, X0 + 6, ly + 8); ly += 13; }
}

/* ---------- builds: saved in the browser, or exported to / imported from a file ---------- */
function buildsHTML() {
  const L = cfg.builds || [];
  return `<div class=pr><div class=pl>Save this build</div><div class=crow><input id=bName type=text maxlength=24 placeholder="Build name"><button class=chip data-act=0>Save</button></div></div>
<div class=pr><div class=pl>Saved builds</div>${L.length ? L.map((x, i) => `<div class=bi><span><b>${esc(x.name)}</b><small>${esc(ctx.bikes[x.bike] ? ctx.bikes[x.bike].short : x.bike)}</small></span><button class=chip data-act=1 data-i=${i}>Load</button><button class=chip data-act=2 data-i=${i} aria-label=Delete>✕</button></div>`).join('') : '<p>Nothing saved yet.</p>'}</div>
<div class=pr><div class=pl>Move to another device</div><div class=crow><button class=chip data-act=3>Export build</button><button class=chip data-act=4>Export all saved</button><button class=chip data-act=5>Import file</button></div><p>Builds are small .json files: export here, copy the file across, import on the other device.</p></div>`;
}
// only the known keys of a bike, every value clamped to what the garage could have set
function clean(bike, c) {
  const o = { ...bike.defaults }; c = c && typeof c === 'object' ? c : {};
  for (const k in bike.parts) if (Number.isInteger(c[k])) o[k] = Math.max(0, Math.min(bike.parts[k].o.length - 1, c[k]));
  for (const s of bike.sliders) if (Number.isFinite(c[s.k])) o[s.k] = Math.max(s.min, Math.min(s.max, Math.round(c[s.k] / (s.step || 1)) * (s.step || 1)));
  for (const t of bike.toggles) if (typeof c[t.k] === 'boolean') o[t.k] = c[t.k];
  for (const k of ['cc', 'cw']) if (/^#[0-9a-f]{6}$/i.test(c[k])) o[k] = c[k];
  return o;
}
const pack = name => { const c = {}, b = ctx.bcfg; for (const k in ctx.bike.defaults) c[k] = b[k]; for (const k of ['cc', 'cw']) if (b[k]) c[k] = b[k]; return { name, bike: ctx.bike.id, c }; };
function apply(r) {
  const bike = ctx.bikes[r.bike]; if (!bike) return;
  if (bike.id !== ctx.bike.id) { cfg.bike = bike.id; G.onBike(); }
  delete ctx.bcfg.cc; delete ctx.bcfg.cw; Object.assign(ctx.bcfg, clean(bike, r.c)); G.onChange(); save(); buildGarage(); pulse();
}
const dl = (name, doc) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build';
function act(a, i) {
  const L = cfg.builds || (cfg.builds = []), nm = ($('bName') && $('bName').value.trim()) || `${ctx.bike.short} #${L.length + 1}`;
  if (a === 0) { L.push(pack(nm)); if (L.length > 30) L.shift(); save(); body(1); say('Build saved', 900); }
  else if (a === 1 && L[i]) { apply(L[i]); say('Loaded ' + L[i].name, 1000); }
  else if (a === 2) { L.splice(i, 1); save(); body(1); }
  else if (a === 3) dl(`cpm-${ctx.bike.id}-${slug(nm)}.json`, { game: GAME, v: 1, ...pack(nm) });
  else if (a === 4) L.length ? dl('cpm-builds.json', { game: GAME, v: 1, builds: L }) : say('Nothing saved to export', 1200);
  else if (a === 5) $('gFile').click();
}
$('gFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    if (f.size > 2e5) throw 0; const j = JSON.parse(await f.text()), L = cfg.builds || (cfg.builds = []), got = [];
    for (const x of (j && Array.isArray(j.builds) ? j.builds : [j])) if (x && ctx.bikes[x.bike] && x.c && typeof x.c === 'object') got.push({ name: String(x.name || 'Imported').slice(0, 24), bike: x.bike, c: clean(ctx.bikes[x.bike], x.c) });
    if (!got.length) throw 0;
    for (const r of got) if (!L.some(y => y.bike === r.bike && y.name === r.name && JSON.stringify(y.c) === JSON.stringify(r.c))) L.push(r);
    cfg.builds = L.slice(-30); apply(got[0]); say(got.length > 1 ? `Imported ${got.length} builds` : 'Imported ' + got[0].name, 1400);
  } catch (err) { say("That isn't a build file", 1600); }
};

addEventListener('pointerdown', e => { if (ctx.GAR && e.target.id === 'gl' && !$('gList').hidden) list(false); });

/* ---------- keys: hold Space / W / ↑ to rev, B to bounce, Esc to leave ---------- */
const REV = new Set(['Space', 'KeyW', 'ArrowUp']), rev = v => { TC.rev = v; $('revB').classList.toggle('on', !!v); };
addEventListener('keydown', e => { if (!ctx.GAR || e.repeat || e.target.type === 'text') return; if (e.code === 'Escape') { if (!$('gList').hidden) list(false); else $('gClose').click(); } else if (REV.has(e.code)) rev(1); else if (e.code === 'KeyB') $('bounceB').click(); });
addEventListener('keyup', e => { if (ctx.GAR && REV.has(e.code)) rev(0); });
