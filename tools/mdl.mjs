#!/usr/bin/env node
// Model Maker files (data/models/*.json, made in maker/model.html, format in js/mdl.js).
//   node tools/mdl.mjs                       check every model: format, index.json in sync, bikes' "mesh" pointing at a bike model. Part of test.mjs
//   node tools/mdl.mjs --shot dir [--id a,b] [--views side,front,top,q] [--guides] [--grid]
//                                            pictures through the maker itself (needs playwright), prints L x W x H, triangles
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdlProblems } from '../js/mdl.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), MD = path.join(ROOT, 'data/models'), rd = f => JSON.parse(readFileSync(f, 'utf8'));
export function mdlTests() {
  const problems = [], ids = existsSync(MD) ? readdirSync(MD).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.slice(0, -5)).sort() : [], kinds = {};
  if (ids.length && JSON.stringify(existsSync(path.join(MD, 'index.json')) ? rd(path.join(MD, 'index.json')) : []) !== JSON.stringify(ids)) problems.push('data/models/index.json does not list exactly the model files (sorted)');
  for (const id of ids) { let m; try { m = rd(path.join(MD, id + '.json')); } catch (e) { problems.push(`model ${id}: ${e.message}`); continue; } kinds[id] = m.kind; for (const p of mdlProblems(m)) problems.push(`model ${id}: ${p}`); if (m.id !== id) problems.push(`model ${id}: id "${m.id}" is not the file name`); }
  for (const b of rd(path.join(ROOT, 'data/bikes/index.json'))) {
    const d = rd(path.join(ROOT, `data/bikes/${b}.json`));
    if (d.mesh && kinds[d.mesh] !== 'bike') problems.push(`bike ${b}: mesh "${d.mesh}" is not a bike model in data/models`);
    if (d.model === 'custom' && !d.mesh) problems.push(`bike ${b}: model "custom" needs a "mesh"`);
  }
  for (const c of rd(path.join(ROOT, 'data/cars/index.json'))) { const d = rd(path.join(ROOT, `data/cars/${c}.json`)); if (d.model === 'mesh' && kinds[d.mesh] !== 'car') problems.push(`car ${c}: mesh "${d.mesh}" is not a car model in data/models`); }
  return { problems, n: ids.length };
}

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
if (process.argv[1]?.endsWith('mdl.mjs')) {
  const r = mdlTests(); for (const p of r.problems) console.log('FAIL ' + p);
  const shot = opt('--shot');
  if (shot && !r.problems.length) {
    let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright'); } catch { console.log('mdl: pictures skipped (no playwright)'); process.exit(0); }
    const { serve } = await import('./serve.mjs'), srv = await serve(0), br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const pg = await br.newPage({ viewport: { width: 900, height: 600 } }), errs = []; pg.on('pageerror', e => errs.push(e.message)); mkdirSync(shot, { recursive: true });
    const ids = opt('--id') ? opt('--id').split(',') : rd(path.join(MD, 'index.json')), ex = (a.includes('--guides') ? '&guides' : '') + (a.includes('--grid') ? '&grid' : '');
    for (const id of ids) for (const v of opt('--views', 'side,front,top,q').split(',')) {
      await pg.goto(`http://localhost:${srv.address().port}/maker/model.html?m=${id}&shot=${v}${ex}`); const info = await pg.waitForFunction(() => window.READY, null, { timeout: 30000 }).then(h => h.jsonValue());
      const f = path.join(shot, `${id}-${v}.png`); await pg.screenshot({ path: f }); console.log(`${f}  ${info.parts} parts, ${info.tris} tris, L x W x H ${info.size.join(' x ')} m`);
    }
    await br.close(); srv.close(); for (const e of errs) console.log('FAIL page: ' + e); if (errs.length) process.exit(1);
  }
  console.log(`mdl: ${r.n} models, ${r.problems.length} problems`); process.exit(r.problems.length ? 1 : 0);
}
