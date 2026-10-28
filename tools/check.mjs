#!/usr/bin/env node
// Static repo checks, no browser, ~1 s. Prints only problems plus one summary line (-v lists every check that ran).
//   node tools/check.mjs [-v]
// What it catches (each of these has bitten a release or a new bike before):
//   release   BUILD (js/config.js) == every ?v= in index.html == newest data/changelog.json entry; version bumped together
//   modules   every relative import resolves, every imported js file is in index.html's import map (else cache busting and the
//             offline service worker miss it), bare imports are mapped, three/addons/* files exist in vendor/, map targets exist
//   syntax    every js/*.js parses as an ES module (node --check)
//   bikes     index.json <-> files, required fields, sane numbers, tables sorted, per-bike sound.parts (known keys, all core
//             groups present, not a copy of another bike), part options / defaults / sliders consistent, final-drive keys exist
//   spec      computeSpec() runs and stays finite for every bike with every single part option (real code, via the headless harness)
//   data      all data/**/*.json parse; map has the expected top-level shape
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, bikeIds, loadBike, computeSpec } from './lib/headless.mjs';

const verbose = process.argv.includes('-v');
const errors = [], warns = [], ran = [];
const err = (area, msg) => errors.push(`[${area}] ${msg}`), warn = (area, msg) => warns.push(`[${area}] ${msg}`);
const rd = rel => readFileSync(path.join(ROOT, rel), 'utf8');
const rdj = rel => JSON.parse(rd(rel));
const ok = name => ran.push(name);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/* ---------- release sync ---------- */
{
  const build = /BUILD\s*=\s*'([^']+)'/.exec(rd('js/config.js'))?.[1], html = rd('index.html');
  if (!build) err('release', "can't read BUILD from js/config.js");
  const vs = new Set([...html.matchAll(/\?v=([\w.-]+)/g)].map(m => m[1]));
  if (vs.size !== 1 || !vs.has(build)) err('release', `index.html ?v= values ${[...vs].join(', ')} do not all equal BUILD ${build}`);
  const cl = rdj('data/changelog.json');
  if (!Array.isArray(cl) || !cl.length) err('release', 'changelog.json is empty or not a list');
  else {
    if (cl[0].v !== build) err('release', `newest changelog entry is ${cl[0].v}, BUILD is ${build}`);
    for (const e of cl.slice(0, 5)) if (!e.v || !e.d || !Array.isArray(e.t) || !e.t.length) err('release', `malformed changelog entry ${JSON.stringify(e).slice(0, 80)}`);
    if (new Set(cl.map(e => e.v)).size !== cl.length) err('release', 'duplicate versions in changelog.json');
  }
  if (!/BUILD/.test(rd('sw.js')) && !/searchParams/.test(rd('sw.js'))) warn('release', 'sw.js no longer reads the version from its URL');
  ok('release');
}

/* ---------- modules ---------- */
const jsFiles = readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
{
  const html = rd('index.html'), map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;
  for (const [k, v] of Object.entries(map)) if (!k.endsWith('/') && !existsSync(path.join(ROOT, v.split('?')[0]))) err('modules', `import map ${k} -> ${v} does not exist`);
  for (const m of html.matchAll(/(?:href|src)="([^"#:]+)"/g)) if (!existsSync(path.join(ROOT, m[1].split('?')[0]))) err('modules', `index.html references missing file ${m[1]}`);
  const used = new Set(), re = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const f of jsFiles) {
    const src = rd('js/' + f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(re)) {
      const s = m[1] || m[2] || m[3];
      if (s.startsWith('.')) {
        const t = path.join('js', s.split('?')[0]);
        if (!existsSync(path.join(ROOT, t))) err('modules', `js/${f}: import '${s}' -> missing file`); else used.add('./js/' + path.basename(t));
      } else if (map[s]) { /* mapped exactly */ }
      else { const pre = Object.keys(map).find(k => k.endsWith('/') && s.startsWith(k)); if (!pre) err('modules', `js/${f}: bare import '${s}' is not in the import map`); else if (!existsSync(path.join(ROOT, map[pre] + s.slice(pre.length)))) err('modules', `js/${f}: '${s}' -> ${map[pre] + s.slice(pre.length)} missing in vendor/`); }
    }
  }
  for (const u of used) if (!map[u]) err('modules', `${u} is imported but missing from index.html's import map (no cache busting, not precached offline)`);
  for (const k of Object.keys(map)) if (k.startsWith('./js/') && !jsFiles.includes(path.basename(k))) err('modules', `import map lists ${k} but the file does not exist`);
  for (const f of jsFiles) if (!used.has('./js/' + f) && f !== 'engine-worklet.js' && f !== 'menu.js') warn('modules', `js/${f} is never imported (dead file?)`);
  ok('modules');
}

/* ---------- syntax ---------- */
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: rd('js/' + f), encoding: 'utf8' });
  if (r.status !== 0) err('syntax', `js/${f}: ${(r.stderr || '').split('\n').filter(l => l.trim()).slice(0, 4).join(' | ')}`);
}
for (const f of ['server/worker.js']) if (existsSync(path.join(ROOT, f))) { const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: rd(f), encoding: 'utf8' }); if (r.status !== 0) err('syntax', `${f}: ${(r.stderr || '').split('\n').slice(0, 4).join(' | ')}`); }
ok('syntax');

/* ---------- bikes ---------- */
const PART_KEYS = new Set(['sq', 'sqHz', 'hiss', 'chain', 'chainHz', 'lash', 'clutch', 'thump', 'thumpHz', 'rattle', 'key', 'keyHz', 'tink', 'tinkHz', 'peg']);
const CORE_GROUPS = ['sq', 'chain', 'clutch', 'thump', 'rattle', 'key', 'tink', 'peg']; // CLAUDE.md: brake squeal, chain, clutch, thump, rattle, key click, tink, peg
const DRIVES = ['manual', 'cvt', 'rotary'];
const bikes = {};
{
  const files = readdirSync(path.join(ROOT, 'data/bikes')).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.slice(0, -5));
  for (const id of bikeIds) if (!files.includes(id)) err('bikes', `index.json lists ${id} but data/bikes/${id}.json does not exist`);
  for (const f of files) if (!bikeIds.includes(f)) err('bikes', `data/bikes/${f}.json is not listed in index.json`);
  if (new Set(bikeIds).size !== bikeIds.length) err('bikes', 'duplicate ids in index.json');
  for (const id of bikeIds) {
    if (!existsSync(path.join(ROOT, `data/bikes/${id}.json`))) continue;
    const b = bikes[id] = loadBike(id), A = `bikes/${id}`;
    if (b.id !== id) err(A, `id field is "${b.id}"`);
    for (const k of ['name', 'short', 'tag', 'blurb', 'model', 'cluster', 'hint']) if (typeof b[k] !== 'string' || !b[k]) err(A, `missing text field ${k}`);
    if (!DRIVES.includes(b.drivetrain)) { err(A, `unknown drivetrain ${b.drivetrain}`); continue; }
    const ch = b.chassis || {}, en = b.engine || {};
    for (const k of ['m', 'r', 'wb', 'lf', 'lr', 'h', 'I', 'drag', 'roll', 'brake']) if (!(isNum(ch[k]) && ch[k] > 0)) err(A, `chassis.${k} must be a positive number`);
    if (isNum(ch.wb) && Math.abs(ch.lf + ch.lr - ch.wb) > .02 * ch.wb) warn(A, `chassis lf+lr (${(ch.lf + ch.lr).toFixed(3)}) differs from wb (${ch.wb})`);
    if (!(Array.isArray(ch.travel) && ch.travel.length === 2 && ch.travel.every(isNum))) err(A, 'chassis.travel must be [front, rear]');
    // pillion seat (js/ride.js, model.js pillionGeo, spec.js withPassenger): dz / dy = how far the rider mesh is shifted back / up onto the pillion
    // seat; x / h = where that passenger sits for the physics (m ahead of the rear axle, centre-of-mass height). node tools/pillion.mjs checks them against the real model
    if (ch.pil === null) { } // solo-seat bike (no pillion): ride.js offers no pillion seat
    else if (!(ch.pil && ['dz', 'dy', 'x', 'h'].every(k => isNum(ch.pil[k])))) err(A, 'chassis.pil must be { dz, dy, x, h } or null for a solo seat (pillion seat, see tools/pillion.mjs)');
    else { const p = ch.pil; if (!(p.dz >= .2 && p.dz <= .45 && p.dy >= -.05 && p.dy <= .2 && p.x >= -.15 && p.x <= .5 && p.h >= 1 && p.h <= 1.5)) warn(A, `chassis.pil ${JSON.stringify(p)} looks off (dz .2-.45, dy -.05-.2, x -.15-.5, h 1-1.5)`); }
    for (const k of ['Ie', 'idle', 'red', 'peakPS', 'tachMax']) if (!(isNum(en[k]) && en[k] > 0)) err(A, `engine.${k} must be a positive number`);
    if (isNum(en.idle) && isNum(en.red) && en.idle >= en.red) err(A, 'engine.idle >= redline');
    if (isNum(en.red) && isNum(en.tachMax) && en.tachMax < en.red) err(A, 'engine.tachMax below redline');
    const sorted = t => Array.isArray(t) && t.length > 1 && t.every((p, i) => Array.isArray(p) && p.length === 2 && p.every(isNum) && (!i || p[0] > t[i - 1][0]));
    if (!sorted(en.torque)) err(A, 'engine.torque must be [[rpm, Nm], ...] with rising rpm');
    else if (en.torque[en.torque.length - 1][0] < en.red) warn(A, 'torque curve ends below the redline (flat extrapolation)');
    if (!(Array.isArray(en.fric) && en.fric.length === 2 && en.fric.every(isNum))) err(A, 'engine.fric must be [a, b]');
    if (!(en.fuel && ['cap', 'idle', 'k'].every(k => isNum(en.fuel[k])))) err(A, 'engine.fuel needs cap, idle, k');
    const D = b.drivetrain === 'cvt' ? b.cvt : b.manual, DN = b.drivetrain === 'cvt' ? 'cvt' : 'manual';
    if (!D) err(A, `drivetrain ${b.drivetrain} needs a "${DN}" block`);
    else if (b.drivetrain === 'cvt') {
      for (const k of ['final', 'eta', 'lo', 'hi']) if (!isNum(D[k])) err(A, `cvt.${k} missing`);
      if (isNum(D.lo) && D.lo <= D.hi) err(A, 'cvt.lo (launch ratio) must be above cvt.hi (top ratio)');
      if (!(D.clutch && isNum(D.clutch.e0) && isNum(D.clutch.e1) && isNum(D.clutch.cap) && D.clutch.e0 < D.clutch.e1)) err(A, 'cvt.clutch needs e0 < e1 and cap');
      if (!(D.variator && ['base', 'roller', 'preload', 'rise', 'load', 'rate'].every(k => isNum(D.variator[k])))) err(A, 'cvt.variator needs base, roller, preload, rise, load, rate');
    } else {
      for (const k of ['prim', 'eta', 'clutchCap']) if (!isNum(D[k])) err(A, `manual.${k} missing`);
      if (!(Array.isArray(D.gears) && D.gears[0] === 0 && D.gears.slice(1).every((g, i, a) => isNum(g) && g > 0 && (!i || g < a[i - 1])))) err(A, 'manual.gears must be [0, 1st, 2nd, ...] strictly falling ratios');
      if (!(Array.isArray(D.final) && D.final.length === 2 && D.final.every(k => k in (b.defaults || {})))) err(A, 'manual.final must name two keys present in defaults (e.g. ["rs","fs"])');
      if (b.drivetrain === 'rotary' && !(Array.isArray(D.cent) && D.cent.length === 2 && D.cent[0] < D.cent[1])) err(A, 'rotary needs manual.cent [bite, lock] rpm');
    }
    { const todo = []; JSON.stringify(b, (k, v) => { if (typeof v === 'string' && /TODO/.test(v)) todo.push(k); return v; }); if (todo.length) err(A, `unfinished: TODO left in ${todo.join(', ')}`); }
    // sound
    const so = b.sound || {}, pr = so.parts;
    if (!pr || typeof pr !== 'object') err(A, 'sound.parts missing: every bike needs its own sound profile (CLAUDE.md)');
    else {
      for (const k of Object.keys(pr)) { if (!PART_KEYS.has(k)) err(A, `sound.parts.${k} is not a key audio.js pv() reads`); else if (!isNum(pr[k]) || pr[k] < 0) err(A, `sound.parts.${k} must be a number >= 0`); }
      for (const k of CORE_GROUPS) if (!(k in pr)) err(A, `sound.parts.${k} missing (set it explicitly, neutral = 1)`);
      if (b.drivetrain === 'cvt' && pr.chain > 0) warn(A, 'belt-drive bike has sound.parts.chain > 0 (use 0 for belt/shaft)');
    }
    for (const [k, v] of Object.entries(so)) if (k !== 'parts' && k !== 'sc' && !isNum(v) && !(Array.isArray(v) && v.every(isNum))) err(A, `sound.${k} is not a number or number list`);
    // parts / defaults / sliders / toggles
    const df = b.defaults || {}, parts = b.parts || {};
    for (const [k, p] of Object.entries(parts)) {
      if (!Array.isArray(p.o) || !p.o.length || !p.o.every(o => o && typeof o === 'object')) { err(A, `parts.${k}.o must be a non-empty list of option objects`); continue; }
      if (!Number.isInteger(df[k]) || df[k] < 0 || df[k] >= p.o.length) err(A, `defaults.${k} = ${df[k]} is not a valid option index (0..${p.o.length - 1})`);
      p.o.forEach((o, i) => { for (const [kk, v] of Object.entries(o)) if (kk !== 'n' && typeof v !== 'string' && typeof v !== 'boolean' && !isNum(v) && !Array.isArray(v) && typeof v !== 'object') err(A, `parts.${k}.o[${i}].${kk} has odd value`); if (typeof o.n !== 'string') warn(A, `parts.${k}.o[${i}] has no name (n)`); });
    }
    for (const s of b.sliders || []) {
      if (!(s.k in df)) err(A, `slider ${s.k} has no default`); else if (!(isNum(s.min) && isNum(s.max) && df[s.k] >= s.min && df[s.k] <= s.max)) err(A, `slider ${s.k} default ${df[s.k]} outside ${s.min}..${s.max}`);
    }
    for (const t of b.toggles || []) if (!(t.k in df)) err(A, `toggle ${t.k} has no default`);
    for (const k of ['kf', 'kr', 'damp']) if (!isNum(df[k])) err(A, `defaults.${k} missing (spec.js reads it)`);
  }
  // copy-paste guard: a profile identical to another bike's means someone skipped "base it on the real bike"
  const ids = Object.keys(bikes), prof = id => JSON.stringify(Object.entries(bikes[id].sound?.parts || {}).sort());
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (prof(ids[i]) === prof(ids[j]) && prof(ids[i]) !== '[]') warn('bikes', `${ids[i]} and ${ids[j]} have identical sound.parts`);
  ok('bikes');
}

/* ---------- spec sweep ---------- */
{
  let n = 0;
  for (const [id, b] of Object.entries(bikes)) {
    if (!DRIVES.includes(b.drivetrain)) continue;
    const variants = [{ n: 'defaults', c: { ...b.defaults } }];
    for (const [k, p] of Object.entries(b.parts || {})) p.o.forEach((_, i) => variants.push({ n: `${k}=${i}`, c: { ...b.defaults, [k]: i } }));
    for (const v of variants) {
      n++;
      try {
        const s = computeSpec(b, v.c);
        for (const [k, x] of Object.entries(s)) if (typeof x === 'number' && !Number.isFinite(x)) { err('spec', `${id} ${v.n}: spec.${k} = ${x}`); break; }
        if (!(s.m > 0 && s.r > 0 && s.red > s.idle && s.tqMax > 0)) err('spec', `${id} ${v.n}: implausible spec (m ${s.m}, r ${s.r}, red ${s.red}, idle ${s.idle}, tqMax ${s.tqMax})`);
      } catch (e) { err('spec', `${id} ${v.n}: computeSpec threw ${e.message}`); }
    }
  }
  ok(`spec (${n} variants)`);
}

/* ---------- new-bike wiring (everything a bike needs outside its own JSON) ---------- */
{
  const model = rd('js/model.js'), hud = rd('js/hud.js'), garage = rd('js/garage.js'), worker = rd('server/worker.js');
  const keys = (src, name) => { const m = new RegExp(`const ${name}\\s*=\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}`).exec(src); return m ? [...m[1].matchAll(/(?:^|,)\s*(\w+)\s*(?::|(?=,|$))/g)].map(x => x[1]).filter(x => x.length > 1) : null; };
  const MODELS = keys(model, 'MODELS'), CLUSTERS = keys(hud, 'CLUSTERS');
  if (!MODELS) warn('wiring', "can't parse MODELS from js/model.js (check.mjs needs updating)"); if (!CLUSTERS) warn('wiring', "can't parse CLUSTERS from js/hud.js (check.mjs needs updating)");
  const WHERE = new Set([...(/const WHERE\s*=\s*\{([\s\S]*?)\};/.exec(garage)?.[1] || '').matchAll(/(\w+)\s*:/g)].map(m => m[1]));
  const legal = rd('LEGAL.md'), readme = rd('README.md'), used = {};
  for (const b of Object.values(bikes)) for (const k of [...Object.keys(b.parts || {}), ...(b.sliders || []).map(x => x.k), ...(b.toggles || []).map(x => x.k)]) (used[k] ||= new Set()).add(b.id);
  // identifiers the js reads off a spec / bike: a part option or chassis key nobody reads is almost always a typo
  const readKeys = new Set(); for (const f of jsFiles) for (const m of rd('js/' + f).matchAll(/\b(?:sp|s|spec|ctx\.spec|sp2)\.(\w+)/g)) readKeys.add(m[1]);
  const SPEC_EXTRA = new Set(['n', 'sc', 'scm', 'scX', 'scD', 'scW', 'var', 'carb', 'abs', 'bf', 'cent', 'slipper', 'eclutch', 'roller', 'lo', 'hi']);
  for (const [id, b] of Object.entries(bikes)) {
    const A = `wiring/${id}`;
    if (!/^[a-z0-9_-]{1,24}$/.test(id)) err(A, `id "${id}" is rejected by the multiplayer relay (server/worker.js: ^[a-z0-9_-]{1,24}$)`);
    const pk = Object.keys(b.parts || {});
    if (pk.length > 24) err(A, `${pk.length} part keys: the relay keeps only 24 (server/worker.js cleanLook), the rest would never show on other phones`);
    for (const k of pk) { if (!/^[a-zA-Z0-9_]{1,16}$/.test(k)) err(A, `part key "${k}" is rejected by the relay (letters/digits/_ only, max 16)`); if (b.parts[k].o.length >= 32) err(A, `parts.${k} has ${b.parts[k].o.length} options: the relay only passes indices < 32`); }
    if (MODELS && !MODELS.includes(b.model)) err(A, `model "${b.model}" is not in MODELS (js/model.js: ${MODELS.join(', ')})`);
    if (CLUSTERS && !CLUSTERS.includes(b.cluster)) err(A, `cluster "${b.cluster}" is not in CLUSTERS (js/hud.js: ${CLUSTERS.join(', ')})`);
    for (const k of [...pk, ...(b.sliders || []).map(x => x.k), ...(b.toggles || []).map(x => x.k)]) if (!WHERE.has(k) && !k.startsWith('cf') && used[k].size === 1) warn(A, `key "${k}" is new and not in garage.js WHERE: it will show up on the PAINT tab`);
    for (const [k, p] of Object.entries(b.parts || {})) for (const o of p.o) for (const kk of Object.keys(o)) if (!readKeys.has(kk) && !SPEC_EXTRA.has(kk)) warn(A, `parts.${k} option key "${kk}" is never read by any js (typo?)`);
    for (const k of Object.keys(b.chassis || {})) if (!readKeys.has(k) && !SPEC_EXTRA.has(k)) warn(A, `chassis.${k} is never read by any js (typo?)`);
    if (b.chassis?.sc && !b.sound?.sc) warn(A, 'sidecar bike without sound.sc overrides (sidecar thump/rattle use the plain-bike values)');
    if (b.chassis?.sc) for (const k of ['scm', 'scX', 'scD', 'scW']) if (!isNum(b.chassis[k]) && !isNum(b.parts && 0)) { /* sc fields may live in a part option */ }
    const nm = b.name.replace(/\s*\/.*$/, '');
    if (!new RegExp(nm.split(/\s+/).slice(0, 3).join('\\s+').replace(/[()]/g, ''), 'i').test(legal)) warn(A, `"${nm}" does not appear in LEGAL.md (add a row: trademark use, body-shape / paint-name review)`);
    if (!readme.includes(b.short) && !readme.includes(nm.split(' ').slice(-2).join(' '))) warn(A, `README.md does not mention "${b.short}" (bike table / model list)`);
  }
  ok('wiring');
}

/* ---------- DOM ids: every $('x') in js exists in the markup (catches UI features that lost their element) ---------- */
{
  const html = rd('index.html'), defined = new Set([...html.matchAll(/\bid=["']?([\w-]+)/g)].map(m => m[1]));
  for (const f of [...jsFiles.map(f => 'js/' + f), 'maker/index.html']) { const src = rd(f); for (const m of src.matchAll(/\bid=["']?([\w-]+)/g)) defined.add(m[1]); for (const m of src.matchAll(/\.id\s*=\s*['"`]([\w-]+)/g)) defined.add(m[1]); for (const m of src.matchAll(/createElement[\s\S]{0,60}?id:\s*['"]([\w-]+)/g)) defined.add(m[1]); }
  const missing = {};
  for (const f of jsFiles) for (const m of rd('js/' + f).matchAll(/(?:\$|getElementById)\(\s*['"]([\w-]+)['"]\s*\)/g)) if (!defined.has(m[1])) (missing[m[1]] ||= new Set()).add(f);
  for (const [id, fs] of Object.entries(missing)) err('dom', `$('${id}') in ${[...fs].join(', ')} but no element with that id in index.html or any template string`);
  ok('dom');
}

/* ---------- data ---------- */
{
  const walk = d => readdirSync(path.join(ROOT, d)).flatMap(f => { const p = path.join(d, f); return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : []; });
  for (const f of walk('data')) { try { JSON.parse(rd(f)); } catch (e) { err('data', `${f}: ${e.message}`); } }
  try { const m = rdj('data/map/island.json'); if (!m || typeof m !== 'object' || Array.isArray(m)) err('data', 'island.json should be an object'); } catch (e) { }
  ok('data');
}

for (const w of warns) console.log('WARN  ' + w);
for (const e of errors) console.log('FAIL  ' + e);
if (verbose) console.log('ran: ' + ran.join(', '));
console.log(errors.length ? `check: ${errors.length} problem(s), ${warns.length} warning(s)` : `check: ok (${ran.length} groups, ${warns.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
