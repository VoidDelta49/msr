#!/usr/bin/env node
// Headless checks of career mode (js/career.js + data/career.json). No browser.
//   node tools/career.mjs [-v]     (also part of tools/test.mjs)
// Fails on: a bike without a price, a starter that isn't a bike, a quest type without a reward, a part option without a price (or a
// stock option that costs money), money going negative or appearing from nowhere, buying without the money, a bought part not
// staying bought, sanitize() leaving a part you don't own fitted, selling your only bike, a broken saved career being accepted,
// and an economy that is out of reach (the cheapest upgrade must take a handful of jobs, the dearest bike must be reachable).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/headless.mjs';
const J = rel => pathToFileURL(path.join(ROOT, rel)).href, verbose = process.argv.includes('-v');
const rdj = f => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const C = await import(J('js/career.js'));

export function careerTests() {
  const P = [], bad = m => P.push('CAREER ' + m), info = [];
  const D = rdj('data/career.json'), ids = rdj('data/bikes/index.json'), bikes = Object.fromEntries(ids.map(id => [id, rdj(`data/bikes/${id}.json`)]));
  let purse = 0; C.walletUse(() => purse, n => { purse = n; });
  C.careerEnv(D, bikes, null);
  // data
  for (const id of ids) if (!(C.bikePrice(id) > 0)) bad(`${id}: no price (srp in data/career.json)`);
  for (const id of Object.keys(D.srp)) if (!bikes[id]) bad(`srp for ${id}, which is not a bike`);
  if (!D.starters.length) bad('no starter bikes'); for (const id of D.starters) if (!bikes[id]) bad(`starter ${id} is not a bike`);
  const src = readFileSync(path.join(ROOT, 'js/missions.js'), 'utf8'), kinds = [...src.match(/const TYPE = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s+(\w+):/gm)].map(m => m[1]);
  if (kinds.length < 5) bad('could not read the quest types from missions.js');
  for (const k of kinds) if (!(D.jobs[k] > 0)) bad(`quest type ${k} has no reward (jobs in data/career.json)`);
  if (D.stars.length !== 4 || D.stars.some((v, i) => i && v < D.stars[i - 1])) bad('stars must be 4 rising multipliers (0-3 stars)');
  let nOpt = 0, lo = 1e9, hi = 0;
  for (const [id, b] of Object.entries(bikes)) for (const [k, p] of Object.entries(b.parts)) {
    if (!D.parts[k]) bad(`${id}: part "${k}" has no price row (uses partDefault)`);
    p.o.forEach((o, i) => { const n = C.partPrice(id, k, i); if (i === (b.defaults[k] | 0)) { if (n) bad(`${id} ${k}: the stock option costs ${n}`); } else { nOpt++; if (!(n > 0)) bad(`${id} ${k}[${i}]: no price`); lo = Math.min(lo, n); hi = Math.max(hi, n); } });
  }
  // a fresh career
  if (C.newCareer('nope') === '') bad('newCareer took a bike that is not a starter');
  const s0 = D.starters[0]; if (C.newCareer(s0)) bad('newCareer failed');
  if (purse !== D.money) bad(`start money ${purse}, data says ${D.money}`);
  if (!C.ownsBike(s0) || C.owned().length !== 1) bad('the starter is not the one bike you own');
  const dear = ids.reduce((a, id) => C.bikePrice(id) > C.bikePrice(a) ? id : a, ids[0]);
  if (!C.buyBike(dear)) bad(`bought the ${dear} with ${purse}`); if (purse !== D.money || C.ownsBike(dear)) bad('a failed buy changed something');
  // parts: buy one, it stays bought, sanitize keeps it; an unbought one is put back to stock
  const b = bikes[s0], k = Object.keys(b.parts).find(k => b.parts[k].o.length > 2), def = b.defaults[k] | 0, i1 = def ? 0 : 1, i2 = def ? 1 : 2;
  const pr = C.partPrice(s0, k, i1); purse = pr + 5; if (C.buyPart(s0, k, i1)) bad('could not buy a part with exactly the money');
  if (purse !== 5 || !C.ownsPart(s0, k, i1) || C.ownsPart(s0, k, i2)) bad('part purchase: wrong money or ownership');
  if (C.buyPart(s0, k, i2) === '') bad('bought a part with no money'); if (purse !== 5) bad('a failed part buy took money');
  const bc = { ...b.defaults, [k]: i2 }; if (C.sanitize(s0, bc) !== 1 || bc[k] !== def) bad('sanitize left an unbought part fitted');
  const bc2 = { ...b.defaults, [k]: i1 }; if (C.sanitize(s0, bc2) || bc2[k] !== i1) bad('sanitize removed a bought part');
  // earning
  purse = 0; const t3 = C.jobPay('parcel', 3, false), t1 = C.jobPay('parcel', 1, false), tl = C.jobPay('parcel', 3, true);
  if (!(t3 > t1 && t1 > 0 && tl > t3)) bad(`job pay not rising with stars / locked bonus: ${t1} ${t3} ${tl}`);
  if (C.payJob('parcel', 3, false) !== t3 || purse !== t3 || C.CS.st.stats.jobs !== 1) bad('payJob did not pay / count');
  const f = C.payFare(85); if (f !== Math.round(85 * D.fareX) || C.CS.st.stats.rides !== 1) bad('payFare did not pay / count');
  if (C.CS.st.stats.earned !== t3 + f) bad('earned total is off');
  purse = 0; if (C.payFuel(10) === '') bad('fuel paid with no money'); if (purse !== 0) bad('money went negative on fuel');
  // selling
  if (C.sellBike(s0) === '') bad('sold the only bike');
  purse = C.bikePrice(D.starters[1] || dear); const s1 = D.starters[1] || dear; if (C.buyBike(s1)) bad('could not buy a second bike');
  C.CS.st.bike = s1; if (C.sellBike(s1)) bad('could not sell'); if (purse !== C.sellPrice(s1) || C.ownsBike(s1) || C.CS.st.bike !== s0) bad('selling: wrong money / bike');
  // saves: junk is refused, a good one survives a round trip (through careerEnv's st)
  for (const j of [null, 5, {}, { own: {} }, { own: { 'BAD ID!': {} } }, { own: { ghostbike: {} } }]) { C.careerEnv(D, bikes, j); if (C.hasCareer()) bad('accepted a broken save ' + JSON.stringify(j)); }
  C.careerEnv(D, bikes, { bike: 'x', own: { [s0]: { [k]: 1 << i1, junk: -3 } }, stats: { jobs: -1, earned: 'a' } });
  if (!C.hasCareer() || C.CS.st.bike !== s0 || !C.ownsPart(s0, k, i1) || C.CS.st.own[s0].junk || C.CS.st.stats.jobs !== 0) bad('a saved career did not load cleanly');
  // economy: the cheapest bike you can buy should take a handful of good jobs, the dearest one a long but finite career
  const avg = Object.values(D.jobs).reduce((a, v) => a + v, 0) / Object.keys(D.jobs).length, buyable = ids.filter(id => !D.starters.includes(id)).map(C.bikePrice).sort((a, b) => a - b);
  const first = Math.max(0, buyable[0] - D.money) / avg, last = buyable[buyable.length - 1] / avg;
  if (first > 15) bad(`the cheapest bike to buy takes ${first.toFixed(0)} three-star jobs`); if (last > 600) bad(`the dearest bike takes ${last.toFixed(0)} three-star jobs`);
  if (lo < 10) bad('a part costs under ₱10');
  info.push(`bikes ${C.peso(Math.min(...ids.map(C.bikePrice)))}..${C.peso(Math.max(...ids.map(C.bikePrice)))}, ${nOpt} part options ${C.peso(lo)}..${C.peso(hi)}, job ${C.peso(avg)} avg at 3 stars`);
  info.push(`first bike after ~${first.toFixed(0)} jobs, the dearest after ~${last.toFixed(0)}`);
  C.walletUse(); C.careerEnv(D, bikes, null);
  if (verbose) console.log(info.join('\n'));
  return { problems: P, summary: info[0] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = careerTests(); for (const p of r.problems) console.log('FAIL ' + p);
  console.log(r.problems.length ? '' : 'career: ok (' + r.summary + ')'); process.exit(r.problems.length ? 1 : 0);
}
