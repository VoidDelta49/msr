// Bike cards for the two pickers (title menu and garage): class, name, drivetrain, power with a bar, kerb-ish mass.
const CLS = { scooter: 'SCOOTER', aerox: 'SCOOTER', underbone: 'UNDERBONE', tmx: 'WORKHORSE', macho: 'WORKHORSE', sport: 'SPORT', rouser: 'SPORT', supersport: 'BIG BIKE', h2: 'HYPERBIKE' };
export const bikeClass = b => CLS[b.model] || 'BIKE';
// power bar on a log scale so 7.6 and 95 PS both read (≈5 PS empty … ≈100 PS full)
const bar = ps => Math.max(6, Math.min(100, Math.log(ps / 5) / Math.log(20) * 100)).toFixed(0);
export function bikeCard(b, on, attr) {
  const ps = b.engine.peakPS;
  return `<button class="bc${on ? ' on' : ''}" ${attr}="${b.id}"><i>${bikeClass(b)}</i><b>${b.short}</b><em>${b.tag}</em><span><u style="width:${bar(ps)}%"></u></span><small>${ps} PS · ${b.chassis.m} kg w/ rider</small></button>`;
}
