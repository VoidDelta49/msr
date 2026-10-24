// Garage: the bike on a pedestal in the studio (studio.js). Tabs of parts, sliders and assists generated from the bike's data
// file, each option showing what it changes; live stats against stock, a dyno curve with the revving engine on it, saved builds
// and JSON export / import. Nothing here touches physics: it edits ctx.bcfg and main.js recomputes the spec.
import { $, lerpTable } from './util.js';
import { ctx, S } from './state.js';
import { cfg, save } from './config.js';
import { computeSpec } from './spec.js';
import { DRIVES } from './drivetrain.js';
import { say } from './hud.js';
import { TC } from './controls.js';
import { view, accent, pulse } from './studio.js';

export const G = { onBike: null, onChange: null };   // set by main.js
const GAME = 'cpm-motor-edition', $$ = s => document.querySelectorAll(s), esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

// [id, label, camera preset]: close-ups per area, the overview tabs keep turning
const TABS = [
  ['engine', 'ENGINE', { az: 1.2, el: .12, r: 2.3, ty: .5, tz: .05 }], ['drive', 'DRIVETRAIN', { az: 1.25, el: .1, r: 2.4, ty: .45, tz: -.15 }],
  ['susp', 'SUSPENSION', { az: .9, el: .1, r: 2.6, ty: .55, tz: .55 }], ['wheels', 'WHEELS & BRAKES', { az: 1.4, el: .08, r: 2.3, ty: .35, tz: .5 }],
  ['look', 'PAINT', { spin: 1, el: .2, r: 3.6, ty: .7, tz: 0 }], ['carbon', 'CARBON', { spin: 1, el: .18, r: 3.3, ty: .7, tz: 0 }],
  ['stats', 'STATS', { spin: 1, el: .2, r: 3.8, ty: .65, tz: 0 }], ['builds', 'BUILDS', { spin: 1, el: .2, r: 3.8, ty: .65, tz: 0 }],
];
const WHERE = { exhaust: 'engine', ecu: 'engine', intake: 'engine', flywheel: 'engine', rollers: 'drive', cspring: 'drive', clspring: 'drive', pulley: 'drive', fs: 'drive', rs: 'drive', autoClutch: 'drive', iss: 'drive',
  pf: 'susp', pr: 'susp', yf: 'susp', yr: 'susp', kf: 'susp', kr: 'susp', damp: 'susp', tires: 'wheels', brakes: 'wheels', wheelcol: 'wheels', rimstripe: 'wheels' };
const where = k => WHERE[k] || (k.startsWith('cf') ? 'carbon' : 'look');
const has = t => t === 'look' || t === 'wheels' || t === 'stats' || t === 'builds' || Object.keys(ctx.bike.parts).some(k => where(k) === t) || ctx.bike.sliders.some(s => where(s.k) === t) || ctx.bike.toggles.some(s => where(s.k) === t);
let tab = 'engine', sId = '', sSpec = null;
const stock = () => (sId !== ctx.bike.id && (sSpec = computeSpec(ctx.bike, ctx.bike.defaults), sId = ctx.bike.id), sSpec);

/* ---------- numbers ---------- */
// engine power at an rpm (PS) from the torque table; peak up to the redline
const pAt = (s, r) => lerpTable(s.TQ, r) * r * s.pow / 7023.5, tAt = (s, r) => lerpTable(s.TQ, r) * s.pow;
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
export function garageFrame() { // each frame while the garage is open: live readout + dyno dot
  const t = performance.now(); if (t - gt < 50) return; gt = t; const s = ctx.spec, r = S.rpm;
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
  return o.slice(0, 3).join(' ');
}
const hex = v => /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888';
function body(keep) {
  const bike = ctx.bike, b = ctx.bcfg, def = bike.defaults; let h = '';
  if (tab === 'stats') h = '<div class=statbox></div>';
  else if (tab === 'builds') h = buildsHTML();
  else {
    for (const [k, p] of Object.entries(bike.parts)) if (where(k) === tab) {
      h += `<div class=pr><div class=pl>${p.l}</div><div class=opts>${p.o.map((o, i) => { const sw = o.c || o.wc || o.rim || o.ec || o.hd; return `<button class="opt${b[k] == i ? ' on' : ''}" data-k=${k} data-i=${i}>${sw ? `<i class=dot style="background:${sw}"></i>` : ''}<b>${o.n}</b>${b[k] == i ? '<small>fitted</small>' : `<small>${delta(k, i)}</small>`}</button>`; }).join('')}</div></div>`;
    }
    for (const s of bike.sliders) if (where(s.k) === tab) h += `<div class=pr><div class=pl>${s.l} <b id=v_${s.k}>${b[s.k]}${s.u}</b>${b[s.k] !== def[s.k] ? `<small> stock ${def[s.k]}${s.u}</small>` : ''}</div><input type=range min=${s.min} max=${s.max} step=${s.step || 1} value=${b[s.k]} data-s=${s.k}></div>`;
    const tg = bike.toggles.filter(s => where(s.k) === tab);
    if (tg.length) h += `<div class=pr><div class=pl>Assists</div><div class=chips>${tg.map(t => `<button class="chip${b[t.k] ? ' on' : ''}" data-t=${t.k}>${t.l}</button>`).join('')}</div></div>`;
    if (tab === 'look' || tab === 'wheels') { const k = tab === 'look' ? 'cc' : 'cw'; h += `<div class=pr><div class=pl>Custom ${tab === 'look' ? 'body' : 'wheel'} colour</div><div class=crow><input type=color data-cc=${k} value="${hex(b[k] || (tab === 'look' ? ctx.spec.c : ctx.spec.wc))}"><button class=chip data-clr=${k}>Clear</button></div></div>`; }
    h += `<div class=pr><button class="chip" data-treset=1>↺ Reset ${TABS.find(t => t[0] === tab)[1].toLowerCase()} to stock</button></div>`;
  }
  $('gBody').innerHTML = h; if (!keep) $('gBody').scrollTop = 0; if (tab === 'stats') { sHtml = ''; stats(); }
}
function tabs() { $('gTabs').innerHTML = TABS.filter(t => has(t[0])).map(t => `<button class="gt gt-${t[0]}${t[0] === tab ? ' on' : ''}" data-tab=${t[0]}>${t[1]}</button>`).join(''); }
function setTab(t) { tab = t; view(TABS.find(x => x[0] === t)[2]); tabs(); body(); }

export function buildGarage() {
  if (!has(tab)) tab = 'engine';
  $('gBikes').innerHTML = Object.values(ctx.bikes).map(k => `<button class="chip${k.id === ctx.bike.id ? ' on' : ''}" data-bike=${k.id}>${k.short}</button>`).join('');
  $('gName').textContent = ctx.bike.tag; accent(ctx.spec.c); setTab(tab); stats();
}
// stock / colour-only: keys that belong to a tab (parts, sliders, assists, custom colours)
const tabKeys = t => [...Object.keys(ctx.bike.parts), ...ctx.bike.sliders.map(s => s.k), ...ctx.bike.toggles.map(s => s.k)].filter(k => where(k) === t).concat(t === 'look' ? ['cc'] : t === 'wheels' ? ['cw'] : []);
function changed(p = true) { save(); G.onChange(); accent(ctx.spec.c); if (p) pulse(); stats(); }

$('garage').onclick = e => {
  const el = e.target.closest('button'); if (!el) return; const d = el.dataset, b = ctx.bcfg;
  if (d.bike) { if (d.bike !== ctx.bike.id) { cfg.bike = d.bike; save(); G.onBike(); buildGarage(); } }
  else if (d.tab) setTab(d.tab);
  else if (d.k) { b[d.k] = +d.i; changed(); body(1); }
  else if (d.t) { b[d.t] = !b[d.t]; el.classList.toggle('on', b[d.t]); changed(false); }
  else if (d.clr) { delete b[d.clr]; changed(); body(1); }
  else if (d.treset) { for (const k of tabKeys(tab)) if (k in ctx.bike.defaults) b[k] = ctx.bike.defaults[k]; else delete b[k]; changed(); body(1); }
  else if (d.act) act(+d.act, +d.i);
};
$('garage').oninput = e => {
  const d = e.target.dataset, b = ctx.bcfg;
  if (d.s) { b[d.s] = +e.target.value; $('v_' + d.s).textContent = b[d.s] + ctx.bike.sliders.find(x => x.k === d.s).u; changed(false); }
  else if (d.cc) { b[d.cc] = e.target.value; changed(false); }
};
// RESET TO STOCK: two taps (the first arms it) so a stray tap can't wipe a build
$('gStock').onclick = () => {
  const el = $('gStock'), idle = () => { el.classList.remove('on'); el.textContent = 'RESET TO STOCK'; }; clearTimeout(el.t);
  if (!el.classList.contains('on')) { el.classList.add('on'); el.textContent = 'TAP AGAIN TO RESET'; el.t = setTimeout(idle, 2500); return; }
  idle(); delete ctx.bcfg.cc; delete ctx.bcfg.cw; Object.assign(ctx.bcfg, ctx.bike.defaults); changed(); body(1); say('Back to stock', 1000);
};

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

/* ---------- keys: hold Space / W / ↑ to rev, B to bounce, Esc to leave ---------- */
const REV = new Set(['Space', 'KeyW', 'ArrowUp']), rev = v => { TC.rev = v; $('revB').classList.toggle('on', !!v); };
addEventListener('keydown', e => { if (!ctx.GAR || e.repeat || e.target.type === 'text') return; if (e.code === 'Escape') $('gClose').click(); else if (REV.has(e.code)) rev(1); else if (e.code === 'KeyB') $('bounceB').click(); });
addEventListener('keyup', e => { if (ctx.GAR && REV.has(e.code)) rev(0); });
