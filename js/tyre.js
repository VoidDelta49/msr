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

// grip multiplier of what is under the bike: asphalt and town lots 1, worn dirt shoulder, grass, paddy mud
const Z = {};
export function surfaceMu(x, z) {
  const nr = ctx.nearRoad ? ctx.nearRoad(x, z) : null, hw = nr ? nr.w / 2 + .3 : 0;
  if (nr && nr.d < hw) return 1;
  let mu = .62;
  if (ctx.zones) { ctx.zones(x, z, Z); if (Z.town > .85) return 1; mu -= .17 * sstep(.4, .8, Z.paddy); }
  if (nr) mu += (.78 - mu) * (1 - sstep(hw, hw + 2.6, nr.d));
  return mu;
}
