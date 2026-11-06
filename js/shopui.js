// The shop panel (#shop): what a counter or a store front sells, with prices, your money and what you're carrying (logic: shop.js,
// data: data/shop.json). Buying puts the item in your bag; DRINK / EAT uses it (places.js plays the animation and applies the effect).
import { $ } from './util.js';
import { SHOP, shopOf, item, buy, peso } from './shop.js';
import { say } from './hud.js';
import { blip } from './audio.js';

const pnl = $('shop'), L = $('shopL'), bag = $('shopBag');
export const SU = { open: '', onUse: null, from: null }; // from = { x, z, r }: walk further than r from here and it closes
const pick = a => Array.isArray(a) ? a[(Math.random() * a.length) | 0] : a || '';
export function openShop(id, from) {
  const S = shopOf(id); if (!S) return; SU.open = id; SU.from = from || null; pnl.hidden = false; document.body.classList.add('shopping');
  $('shopN').textContent = S.name; $('shopG').textContent = '“' + pick(S.greet) + '”'; draw(); blip('click');
}
export function closeShop() { if (!SU.open) return; SU.open = ''; pnl.hidden = true; document.body.classList.remove('shopping'); }
$('shopX').onclick = closeShop;
function row(I, btn, fn, sub) {
  const r = document.createElement('div'); r.className = 'srow';
  r.innerHTML = '<span class="si"></span><span class="sn"><b></b><small></small></span><button class="b"></button>';
  r.children[0].textContent = I.icon; r.children[1].firstChild.textContent = I.name; r.children[1].lastChild.textContent = sub; r.children[2].textContent = btn; r.children[2].onclick = fn; return r;
}
export function draw() {
  if (!SU.open) return; const S = shopOf(SU.open); $('shopM').textContent = peso(SHOP.money);
  L.replaceChildren(...S.items.map(id => { const I = item(id); return I && row(I, 'BUY ' + peso(I.price), () => { const why = buy(SU.open, id); if (why) { say(why, 1800); blip('thud', 1); } else { say(`${I.icon} ${I.name} bought · ${peso(SHOP.money)} left`, 1600); blip('ok'); } draw(); }, I.desc || ''); }).filter(Boolean));
  const mine = Object.entries(SHOP.bag).filter(([, n]) => n > 0);
  bag.replaceChildren(...(mine.length ? [Object.assign(document.createElement('h4'), { textContent: 'Carrying' })] : []), ...mine.map(([id, n]) => { const I = item(id); return row(I, I.use || 'USE', () => { if (SU.onUse) SU.onUse(id); draw(); }, '× ' + n); }));
}
