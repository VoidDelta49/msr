// Tyre force model: slip -> force curve, surface grip. The bike solver (physics.js) builds the friction circle,
// wheelspin and lock-ups from these.
import { sstep } from './util.js';
import { ctx } from './state.js';

export const KP = .12; // slip ratio at peak force
export const MUX = 1.1; // tyre peak friction relative to sp.mu (the bike's grip number is a conservative, game-balanced one)
export const BRK = 1.3; // brakes can out-pull the tyres (so they can lock, or stand the bike on its nose)
export const KS = .85; // sliding force / peak force
// normalised longitudinal force for x = |slip| / KP: rises to 1 at x = 1, then eases down to the sliding level KS
export const tyreF = x => x <= 1 ? Math.sin(1.5707963 * x) : KS + (1 - KS) / (1 + .5 * (x - 1) * (x - 1));

// Wet road (12.00, weather.js): grip x for `wet` 0..1 of water on the road (ctx.wet) at speed v. wet = 0 is exactly 1.
//  - wet asphalt: a road tyre keeps ~70 % of its dry grip. sp.wetg = the fitted tyre's wet grip (1 road tyre; siped / narrow
//    more, wide and slick less: the loss is 0.3 / wetg).
//  - mud: dirt and grass (surf < 1) lose more again when soaked.
//  - slick 0..1: painted lines and steel bridge joints are like ice when wet.
//  - hydroplaning: on a soaked road (wet > 0.6) the tyre starts to ride up on the water from 21 m/s x sp.aqua
//    (narrow tyres cut through: later; wide and slick: sooner), down to half grip 14 m/s above that.
export function wetGrip(wet, v, sp, surf = 1, slick = 0) {
  if (!(wet > 0)) return 1;
  let k = 1 - wet * Math.min(.6, Math.max(.08, .3 / (sp.wetg || 1)) + .3 * (1 - surf) + .3 * slick);
  const deep = sstep(.6, 1, wet); if (deep > 0) { const v0 = 21 * (sp.aqua || 1); k *= 1 - .5 * deep * sstep(v0, v0 + 14, Math.abs(v)); }
  return k;
}
// 0..1: how slippery-when-wet the spot is beyond plain asphalt: the painted centre line of a road, a bridge deck's joints
export function slickAt(x, z) {
  const nr = ctx.nearRoad ? ctx.nearRoad(x, z) : null; if (!nr || nr.d > nr.w / 2) return 0;
  return nr.d < .14 ? 1 : nr.br ? .35 : 0;
}

// grip multiplier of what is under the bike: asphalt and town lots 1, worn dirt shoulder, grass, paddy mud
const Z = {};
export function surfaceMu(x, z) {
  if (ctx.ug && ctx.ug.has(x, z)) return ctx.ug.mu(x, z); // Ilalim: packed dirt and rock, slick in the lake (under.js)
  const nr = ctx.nearRoad ? ctx.nearRoad(x, z) : null, hw = nr ? nr.w / 2 + .3 : 0;
  if (nr && nr.d < hw) return 1;
  let mu = .62;
  if (ctx.zones) { ctx.zones(x, z, Z); if (Z.town > .85) return 1; mu -= .17 * sstep(.4, .8, Z.paddy); }
  if (nr) mu += (.78 - mu) * (1 - sstep(hw, hw + 2.6, nr.d));
  return mu;
}
