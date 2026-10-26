#!/usr/bin/env node
// Scaffold a new bike from an existing one, then prints what is left to do. The copy is full of TODO markers on purpose:
// tools/check.mjs FAILS while any "TODO" is left in the bike's JSON, so an unfinished bike can't be pushed by accident.
//   node tools/new-bike.mjs <id> --from <existing id> [--name "Real Model Name"]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, bikeIds, loadBike } from './lib/headless.mjs';

const a = process.argv.slice(2), id = a[0], opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; }, from = opt('--from'), name = opt('--name');
if (!id || !from || !/^[a-z0-9_-]{1,24}$/.test(id)) { console.error('usage: node tools/new-bike.mjs <id: a-z0-9_- max 24> --from <' + bikeIds.join('|') + '> [--name "Brand Model"]'); process.exit(2); }
if (bikeIds.includes(id) || existsSync(path.join(ROOT, `data/bikes/${id}.json`))) { console.error(id + ' already exists'); process.exit(2); }
if (!bikeIds.includes(from)) { console.error('unknown --from bike ' + from); process.exit(2); }
const b = loadBike(from); b.id = id; b.name = name || 'TODO real brand + model'; b.short = 'TODO short name'; b.tag = 'TODO e.g. 5-speed manual · wet clutch'; b.blurb = 'TODO one paragraph, real facts only'; b.hint = 'TODO how to start / ride it';
writeFileSync(path.join(ROOT, `data/bikes/${id}.json`), JSON.stringify(b, null, 1) + '\n');
const idx = path.join(ROOT, 'data/bikes/index.json'); writeFileSync(idx, JSON.stringify([...bikeIds, id]) + '\n');
console.log(`created data/bikes/${id}.json (copy of ${from}) and added it to index.json. To finish:
 1. Real numbers: chassis (m, r, wb, lf+lr=wb, h, I, drag, brake), engine (torque curve, idle/red/tachMax, peakPS, fuel), manual/cvt block, defaults, parts, sliders.
 2. sound.parts based on the REAL bike (brakes, drivetrain, weight, body); not a copy of ${from}'s. Compare: node tools/bike.mjs ${id}
 3. model / cluster: pick from existing keys, or add a builder to MODELS (js/model.js) / CLUSTERS (js/hud.js). New part keys land on the PAINT tab unless listed in WHERE (js/garage.js).
 4. Replace every TODO (name, short, tag, blurb, hint), add the bike to LEGAL.md (trademark use) and the README bike list/model list.
 5. node tools/check.mjs   -> must be clean;  node tools/sweep.mjs ${id}  -> no flags;  node tools/fuzz.mjs ${id}
 6. node tools/test.mjs --update  (adds its numbers to baseline.json), then bump BUILD + ?v= + changelog and push to main.`);
