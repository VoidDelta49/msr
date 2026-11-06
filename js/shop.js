// Shops, money and the things you carry. Pure logic (no three.js, no DOM; storage is localStorage when there is one) so
// tools/interior.mjs runs it headless. What is sold, where, for how much and what it does is data/shop.json:
//   items  { id: { name, icon, price, fx: { effect: amount } (js/effects.js), use: verb on the button, line: what you say } }
//   shops  { id: { name, items: [ids], greet: [lines], doors: [building types where you can buy at the front door (walk-up)] } }
// Interiors (data/interiors.json) put a shop at a counter: { shop: id, x, z }. A new item / shop is data only.
import { applyFx } from './effects.js';

export const SHOP = { D: null, money: 0, bag: {}, ready: false };
const KM = 'cpm.wallet', KB = 'cpm.bag', START = 300; // pocket money on a first run
const ls = (() => { try { return globalThis.localStorage || null; } catch (e) { return null; } })();
const rd = (k, d) => { try { const v = ls && ls.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const wr = (k, v) => { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch (e) { } };
export const saveShop = () => { wr(KM, SHOP.money); wr(KB, SHOP.bag); };

// data + saved state (tests pass { money, bag } to start clean)
export function shopEnv(D, st) {
  SHOP.D = D; SHOP.ready = true;
  const m = st ? st.money : rd(KM, START); SHOP.money = Number.isFinite(m) && m >= 0 ? Math.round(m) : START;
  const b = st ? st.bag : rd(KB, {}); SHOP.bag = {};
  for (const [k, n] of Object.entries(b && typeof b === 'object' ? b : {})) if (D.items[k] && n > 0) SHOP.bag[k] = Math.min(99, n | 0);
}
export const item = id => SHOP.D && SHOP.D.items[id];
export const shopOf = id => SHOP.D && SHOP.D.shops[id];
export const peso = n => '₱' + Math.round(n);
// shops you can buy from at a building's front door (walk-up), by building type
export function walkup(t) { if (!SHOP.D) return null; for (const [id, s] of Object.entries(SHOP.D.shops)) if ((s.doors || []).includes(t)) return id; return null; }

export function earn(n) { if (!(n > 0)) return; SHOP.money += Math.round(n); saveShop(); }
// '' = bought (the item is in your bag), else why not
export function buy(shop, id) {
  const S = shopOf(shop), I = item(id);
  if (!S || !I || !S.items.includes(id)) return "They don't sell that here";
  if (SHOP.money < I.price) return `Not enough money (${peso(I.price)}, you have ${peso(SHOP.money)})`;
  if ((SHOP.bag[id] | 0) >= 99) return 'Your hands are full';
  SHOP.money -= I.price; SHOP.bag[id] = (SHOP.bag[id] | 0) + 1; saveShop(); return '';
}
// a gift (a friend treated you): into the bag for free
export function gift(id) { if (!item(id)) return false; SHOP.bag[id] = Math.min(99, (SHOP.bag[id] | 0) + 1); saveShop(); return true; }
// pay for something given away (treating a friend): '' = paid
export function pay(n) { if (SHOP.money < n) return `Not enough money (${peso(n)}, you have ${peso(SHOP.money)})`; SHOP.money -= Math.round(n); saveShop(); return ''; }
// consume one: { ok, msg } (msg = the effects' line)
export function use(id) {
  const I = item(id); if (!I || !(SHOP.bag[id] > 0)) return { ok: false, msg: 'You have none' };
  if (--SHOP.bag[id] <= 0) delete SHOP.bag[id]; saveShop();
  return { ok: true, msg: applyFx(I.fx) };
}
// what you'd use next from the bag (the one bought last is first in the object order after a re-add, so prefer drinks you just got)
export function next() { const ks = Object.keys(SHOP.bag).filter(k => SHOP.bag[k] > 0); return ks.length ? ks[ks.length - 1] : null; }
export const bagCount = () => Object.values(SHOP.bag).reduce((a, b) => a + b, 0);
