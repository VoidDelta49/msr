// Settings: global options + one settings block per bike, stored in localStorage 'cpmme'
export const GLOBAL_DEF = { bike: 'raider150', sound: true, forceGL: false, showFps: true, showApi: true, sens: 10, rapier: true };
export const cfg = { ...GLOBAL_DEF, bikes: {} };
try {
  const old = JSON.parse(localStorage.getItem('cpmme') || '{}');
  // pre-1.0 saves were flat (Raider-only): move bike keys into bikes.raider150
  if (old && !old.bikes) {
    const b = {};
    for (const k of ['exhaust', 'ecu', 'tires', 'paint', 'fs', 'rs', 'kf', 'kr', 'damp', 'autoClutch']) if (k in old) { b[k] = old[k]; delete old[k]; }
    old.bikes = { raider150: b };
  }
  Object.assign(cfg, old);
} catch (e) { }
export const save = () => { try { localStorage.setItem('cpmme', JSON.stringify(cfg)); } catch (e) { } };
// settings for one bike, filled with that bike's defaults
export function bikeCfg(bike) {
  const c = cfg.bikes[bike.id] || (cfg.bikes[bike.id] = {});
  for (const [k, v] of Object.entries(bike.defaults)) if (!(k in c)) c[k] = v;
  return c;
}
