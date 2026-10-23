// Garage: bike picker + that bike's parts, sliders and assists, all generated from its data file.
import { $ } from './util.js';
import { ctx } from './state.js';
import { cfg, save } from './config.js';

export const G = { onBike: null, onChange: null };   // set by main.js
function stats() {
  const s = ctx.spec, b = ctx.bcfg;
  $('gstats').innerHTML = ctx.drive.stats(s, b) + `<br>Peak ≈ ${(s.peakPS * s.pow).toFixed(1)} PS · max lean ${(Math.atan(s.mu * .9) * 57.3).toFixed(0)}° · braking ${(s.mu * s.brake).toFixed(2)} g<br>Sag ${(s.sag * 100).toFixed(1)} cm · ride height ${(s.pf + s.pr) * 500 >= 0 ? '+' : ''}${((s.pf + s.pr) * 500).toFixed(0)} mm · damping ${b.damp < 35 ? 'bouncy' : b.damp > 65 ? 'stiff' : 'balanced'} · tank ${s.fuel.cap} L`;
}
export function buildGarage() {
  const bike = ctx.bike, b = ctx.bcfg; let h = `<div class=bikes>${Object.values(ctx.bikes).map(k => `<button class="chip${k.id === bike.id ? ' on' : ''}" data-bike=${k.id}>${k.short}<small>${k.tag}</small></button>`).join('')}</div><p>${bike.blurb}</p>`;
  for (const [k, p] of Object.entries(bike.parts)) h += `<div class=row><span>${p.l}</span><div class=chips>${p.o.map((o, i) => `<button class="chip${b[k] == i ? ' on' : ''}" data-k=${k} data-i=${i}>${o.n}</button>`).join('')}</div></div>`;
  for (const s of bike.sliders) h += `<div class=row><span>${s.l} <b id=v_${s.k}>${b[s.k]}${s.u}</b></span><input type=range min=${s.min} max=${s.max} value=${b[s.k]} data-s=${s.k}></div>`;
  if (bike.toggles.length) h += `<div class=row><span>Assists</span><div class=chips>${bike.toggles.map(t => `<button class="chip${b[t.k] ? ' on' : ''}" data-t=${t.k}>${t.l}</button>`).join('')}</div></div>`;
  h += `<div id=gstats></div>`; $('gbody').innerHTML = h; stats();
}
function changed() { save(); G.onChange(); stats(); }
$('gbody').onclick = e => {
  const btn = e.target.closest('button'); if (!btn) return; const b = ctx.bcfg;
  if (btn.dataset.bike) { if (btn.dataset.bike !== ctx.bike.id) { cfg.bike = btn.dataset.bike; save(); G.onBike(); buildGarage(); } return; }
  if (btn.dataset.k) { b[btn.dataset.k] = +btn.dataset.i; btn.parentNode.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === btn)); }
  else if (btn.dataset.t) { b[btn.dataset.t] = !b[btn.dataset.t]; btn.classList.toggle('on', b[btn.dataset.t]); }
  changed();
};
$('gbody').oninput = e => { const k = e.target.dataset.s; if (!k) return; ctx.bcfg[k] = +e.target.value; $('v_' + k).textContent = ctx.bcfg[k] + ctx.bike.sliders.find(x => x.k === k).u; changed(); };
