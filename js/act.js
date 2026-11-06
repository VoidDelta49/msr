// On-foot context actions: one button (#bFoot, F / E on a keyboard) does whatever makes sense where you stand: GET ON next to your bike,
// ENTER at a building with an interior, BUY at a shop's front door, ORDER at a bar counter, SHOOT at a pool table, EXIT at the door
// inside, DRINK when you're carrying something. Modules register a provider: () => { label, pri, run } | null; the nearest / most
// important one wins (lower pri first, then distance d). Pure (no DOM): main.js draws the label and calls run().
const PROV = [];
export const addAct = (f, name = '') => { PROV.push({ f, name }); };
export function pickAct() {
  let best = null;
  for (const p of PROV) { let a = null; try { a = p.f(); } catch (e) { console.warn('act ' + p.name, e); } if (a && (!best || (a.pri ?? 5) < (best.pri ?? 5) || ((a.pri ?? 5) === (best.pri ?? 5) && (a.d ?? 9) < (best.d ?? 9)))) best = a; }
  return best;
}
