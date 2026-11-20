// Career mode: buy bikes and parts with money earned from quests and passenger fares. Pure logic (no three.js, no DOM; storage is
// localStorage when there is one) so tools/career.mjs runs it headless. Prices, rewards and the starter bikes are data/career.json.
// Saved state (localStorage 'cpm.career'):
//   { v, bike: the bike you ride, own: { bikeId: { partKey: bitmask of bought option indices } }, bikes: { bikeId: garage settings },
//     stats: { jobs, rides, earned, spent }, t: started (ms) }
// The money itself is the shop.js wallet under 'cpm.career.wallet' (the same pesos buy drinks), reached through CS.wallet so the
// menu (no shop loaded yet) and the game (shop.js owns it) never hold two copies. config.js swaps cfg.bike / cfg.bikes to the
// career's own while career mode is on, so a free-ride garage build never leaks into a career and back.
export const CS = { D: null, st: null, bikes: null };
export const KEY = 'cpm.career', WALLET = 'cpm.career.wallet', BAG = 'cpm.career.bag', PRE = 'cpm.career.';
const ls = (() => { try { return globalThis.localStorage || null; } catch (e) { return null; } })();
const rd = (k, d) => { try { const v = ls && ls.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
const wr = (k, v) => { try { if (ls) { if (v == null) ls.removeItem(k); else ls.setItem(k, JSON.stringify(v)); } } catch (e) { } };
const num = (v, d = 0) => Number.isFinite(v) && v >= 0 ? v : d;

// money: the menu reads / writes the stored wallet, the game hands over shop.js (walletUse) once it has loaded
const lsWallet = { get: () => Math.round(num(rd(WALLET, 0))), set: n => wr(WALLET, Math.round(n)) };
CS.wallet = lsWallet;
export function walletUse(get, set) { CS.wallet = get ? { get, set } : lsWallet; }
export const money = () => CS.wallet.get();
export const peso = n => '₱' + Math.round(n).toLocaleString('en-US');

function clean(s) { // a stored career, or null if it isn't one
  if (!s || typeof s !== 'object' || !s.own || typeof s.own !== 'object' || !Object.keys(s.own).length) return null;
  const own = {}; for (const [id, p] of Object.entries(s.own)) if (/^[a-z0-9_-]{1,24}$/.test(id)) { own[id] = {}; for (const [k, m] of Object.entries(p && typeof p === 'object' ? p : {})) if (Number.isInteger(m) && m > 0) own[id][k] = m; }
  if (!Object.keys(own).length) return null;
  const st = s.stats || {};
  return { v: 1, bike: own[s.bike] ? s.bike : Object.keys(own)[0], own, bikes: s.bikes && typeof s.bikes === 'object' ? s.bikes : {}, t: num(s.t, Date.now()),
    stats: { jobs: num(st.jobs) | 0, rides: num(st.rides) | 0, earned: num(st.earned) | 0, spent: num(st.spent) | 0 } };
}
CS.st = clean(rd(KEY, null)); // at import: config.js needs the career's bike settings before anything is built
export const saveCareer = () => { if (CS.st) wr(KEY, CS.st); };
export const hasCareer = () => !!CS.st;

// data + bikes (id -> bike definition); tests pass st to start from a given career (or null for none) and a wallet
export function careerEnv(D, bikes, st) {
  CS.D = D; CS.bikes = bikes;
  if (st !== undefined) CS.st = clean(st);
  if (CS.st) for (const id of Object.keys(CS.st.own)) if (!bikes[id]) delete CS.st.own[id]; // a bike that left the game
  if (CS.st && !Object.keys(CS.st.own).length) CS.st = null;
  if (CS.st && !CS.st.own[CS.st.bike]) CS.st.bike = Object.keys(CS.st.own)[0];
}

/* ---------- prices ---------- */
export function bikePrice(id) { const D = CS.D, s = D && D.srp[id]; return s ? Math.max(10, Math.round(s * D.priceScale / 10) * 10) : 0; }
export const tier = id => { const D = CS.D; return Math.min(D.tierMax, Math.max(D.tierMin, Math.sqrt(bikePrice(id) / D.tierRef))); };
// price of option i of part k on a bike: 0 = stock (always yours)
export function partPrice(id, k, i) {
  const b = CS.bikes[id], p = b && b.parts[k]; if (!p || !p.o[i]) return 0; const def = b.defaults[k] | 0; if (i === def) return 0;
  const [base, step] = CS.D.parts[k] || CS.D.partDefault, rank = i < def ? i : i - 1; // rank among the non-stock options, in list order
  return Math.max(10, Math.round(base * tier(id) * (1 + step * rank) / 10) * 10);
}
export const sellPrice = id => Math.round(bikePrice(id) * CS.D.sellBack / 10) * 10;

/* ---------- what you own ---------- */
export const ownsBike = id => !!(CS.st && CS.st.own[id]);
export const owned = () => CS.st ? Object.keys(CS.bikes || {}).filter(id => CS.st.own[id]) : [];
export function ownsPart(id, k, i) {
  const b = CS.bikes[id]; if (!b || !ownsBike(id)) return false; if (i === (b.defaults[k] | 0)) return true;
  return !!((CS.st.own[id][k] | 0) & (1 << i));
}
// garage settings: any part option you don't own goes back to stock (old saves, imports, a sold-and-rebought bike)
export function sanitize(id, bc) {
  const b = CS.bikes[id]; if (!b || !bc) return 0; let n = 0;
  for (const k of Object.keys(b.parts)) if (k in bc && !ownsPart(id, k, bc[k] | 0)) { bc[k] = b.defaults[k]; n++; }
  return n;
}

/* ---------- buying, selling, earning: '' = done, else why not ---------- */
function spend(n) { const m = money(); if (m < n) return `Not enough money: ${peso(n)}, you have ${peso(m)}`; CS.wallet.set(m - n); CS.st.stats.spent += n; return ''; }
export function newCareer(starter) {
  const D = CS.D; if (!D.starters.includes(starter) || !CS.bikes[starter]) return 'Pick one of the starter bikes';
  CS.st = { v: 1, bike: starter, own: { [starter]: {} }, bikes: {}, t: Date.now(), stats: { jobs: 0, rides: 0, earned: 0, spent: 0 } };
  CS.wallet.set(D.money); wr(BAG, null); saveCareer(); return '';
}
export function endCareer() { CS.st = null; wr(KEY, null); wr(WALLET, null); wr(BAG, null); }
export function buyBike(id) {
  if (!CS.st) return 'No career running'; if (!CS.bikes[id] || !bikePrice(id)) return 'Not for sale'; if (ownsBike(id)) return 'You already own it';
  const why = spend(bikePrice(id)); if (why) return why; CS.st.own[id] = {}; delete CS.st.bikes[id]; saveCareer(); return '';
}
export function sellBike(id) {
  if (!ownsBike(id)) return "You don't own it"; if (owned().length < 2) return "You can't sell your only bike";
  const n = sellPrice(id); delete CS.st.own[id]; delete CS.st.bikes[id]; if (CS.st.bike === id) CS.st.bike = owned()[0];
  CS.wallet.set(money() + n); saveCareer(); return '';
}
export function buyPart(id, k, i) {
  if (!ownsBike(id)) return "You don't own this bike"; if (ownsPart(id, k, i)) return '';
  const n = partPrice(id, k, i); if (!n) return 'Not for sale'; const why = spend(n); if (why) return why;
  CS.st.own[id][k] = (CS.st.own[id][k] | 0) | (1 << i); saveCareer(); return '';
}
function gain(n) { n = Math.round(n); if (!(n > 0) || !CS.st) return 0; CS.wallet.set(money() + n); CS.st.stats.earned += n; saveCareer(); return n; }
// a finished quest: pesos by job type and stars (0-3), more for a job that needed a specific bike
export function jobPay(type, stars, locked) {
  const D = CS.D, b = D.jobs[type] || 0, s = D.stars[Math.max(0, Math.min(3, stars | 0))];
  return Math.round(b * s * (locked ? D.lockedBonus : 1) / 5) * 5;
}
export function payJob(type, stars, locked) { const n = gain(jobPay(type, stars, locked)); if (n) { CS.st.stats.jobs++; saveCareer(); } return n; }
// a passenger's fare (npc.js works it out from the distance); returns what you got
export function payFare(fare) { const n = gain(fare * CS.D.fareX); if (n) { CS.st.stats.rides++; saveCareer(); } return n; }
// fuel at the station: pesos for that many litres
export const fuelCost = l => l * CS.D.fuel;
export function payFuel(n) { n = Math.round(n); if (!(n > 0)) return ''; const why = spend(n); if (!why) saveCareer(); return why; }
