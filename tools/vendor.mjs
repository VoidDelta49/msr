#!/usr/bin/env node
// Rebuilds vendor/ from the npm packages, made small for the download (the game's biggest files):
//   three.js   build/three.{core,webgpu,tsl}.js + every three/addons/* file js/ imports, minified with esbuild
//              (--keep-names, licence comments kept). Same code, ~1/3 of the bytes.
//   Rapier     @dimforge/rapier3d-compat's dist/rapier.mjs with its base64 WASM moved out to rapier.wasm (fetched by
//              rapier.mjs at init), and the WASM pruned to what the game can reach: every property name js/rapier.js uses
//              (world.createCollider, R.ColliderDesc, body.setLinvel, ...) is a root, the JS glue is followed by name from
//              there (over-approximate: any method of that name in any class), and wasm-metadce drops every export the
//              glue cannot reach plus the code only they used (soft bodies, convex decomposition, character / vehicle
//              controllers, scene queries, serialization, joints API, ...). The roots are saved to vendor/rapier/roots.json;
//              tools/check.mjs fails when js/rapier.js starts using a name that is not in it (re-run this tool then).
//              Self-test: the game's Rapier usage (bodies, capsules, round boxes, a trimesh, enable / disable, both step
//              paths, removals, a crash tumble) runs on the full and the pruned WASM and must give bit-identical states.
//   sw.js      VENDOR = hash of vendor/: the offline cache keeps vendor/ across releases while this hash is unchanged.
// Needs network for npm (packages + esbuild, binaryen, acorn into a temp folder). ~1 min.
//   node tools/vendor.mjs            rebuild everything
//   node tools/vendor.mjs --hash     only refresh the VENDOR hash in sw.js (after editing vendor/ by hand)
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/headless.mjs';

const THREE = '0.187.0', RAPIER = '0.21.0';
const TOOLS = { esbuild: '0.28.2', binaryen: '132.0.0', acorn: '8.19.0', 'acorn-walk': '8.3.5' };
const WASM_FEATURES = ['--enable-bulk-memory', '--enable-bulk-memory-opt', '--enable-nontrapping-float-to-int', '--enable-sign-ext', '--enable-mutable-globals', '--enable-multivalue', '--enable-reference-types', '--enable-call-indirect-overlong'];
const rel = p => path.join(ROOT, p);

// content hash of vendor/ (paths + bytes), shared with tools/check.mjs
export function vendorHash() {
  const h = createHash('sha256'), walk = d => { for (const e of readdirSync(rel(d), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else { h.update(p + '\0'); h.update(readFileSync(rel(p))); } } };
  walk('vendor'); return h.digest('hex').slice(0, 12);
}
// every property name js/rapier.js uses: the roots of the Rapier pruning (over-approximate on purpose)
export function rapierNames() {
  const src = readFileSync(rel('js/rapier.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const n = new Set(['init', 'free', 'version']); for (const m of src.matchAll(/\.([A-Za-z_$][\w$]*)/g)) n.add(m[1]); return [...n].sort();
}
function setHash() {
  const sw = readFileSync(rel('sw.js'), 'utf8'), h = vendorHash(), out = sw.replace(/const VENDOR = '[^']*'/, `const VENDOR = '${h}'`);
  if (out === sw && !sw.includes(`'${h}'`)) throw new Error("sw.js has no `const VENDOR = '...'` line");
  writeFileSync(rel('sw.js'), out); console.log('sw.js VENDOR =', h);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (process.argv.includes('--hash')) setHash(); else await build();
}

async function build() {
  const W = mkdtempSync(path.join(os.tmpdir(), 'vendor-')), sh = (cmd, args, o = {}) => execFileSync(cmd, args, { cwd: W, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, ...o });
  try {
    console.log('npm: packages + tools into', W);
    sh('npm', ['pack', '--silent', `three@${THREE}`, `@dimforge/rapier3d-compat@${RAPIER}`]);
    for (const t of readdirSync(W).filter(f => f.endsWith('.tgz'))) { const d = path.join(W, t.replace(/-\d.*$/, '')); mkdirSync(d); sh('tar', ['xzf', t, '-C', d]); }
    sh('npm', ['install', '--silent', '--no-save', '--no-audit', '--no-fund', '--prefix', path.join(W, 'tools'), ...Object.entries(TOOLS).map(([k, v]) => `${k}@${v}`)]);
    const bin = n => path.join(W, 'tools/node_modules/.bin', n), req = createRequire(path.join(W, 'tools/'));

    /* ---------- three.js ---------- */
    const T = path.join(W, 'three/package'), files = ['build/three.core.js', 'build/three.webgpu.js', 'build/three.tsl.js'];
    const jsAll = d => readdirSync(rel(d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? jsAll(d + '/' + e.name) : e.name.endsWith('.js') ? [d + '/' + e.name] : []);
    for (const f of jsAll('js')) for (const m of readFileSync(rel(f), 'utf8').matchAll(/three\/addons\/([\w\/.-]+\.js)/g)) if (!files.includes('examples/jsm/' + m[1])) files.push('examples/jsm/' + m[1]);
    rmSync(rel('vendor/three'), { recursive: true, force: true });
    for (const f of files) {
      const out = rel('vendor/three/' + f); mkdirSync(path.dirname(out), { recursive: true });
      sh(bin('esbuild'), [path.join(T, f), '--minify', '--keep-names', '--format=esm', '--legal-comments=inline', '--log-level=warning', '--outfile=' + out]);
    }
    copyFileSync(path.join(T, 'LICENSE'), rel('vendor/three/LICENSE'));
    console.log('three', THREE + ':', files.length, 'files minified');

    /* ---------- Rapier ---------- */
    const P = path.join(W, 'dimforge-rapier3d-compat/package'), src = readFileSync(path.join(P, 'dist/rapier.mjs'), 'utf8');
    const b64 = /([\w$]+)\.toByteArray\("([A-Za-z0-9+/=]{10000,})"\)\.buffer/.exec(src); if (!b64) throw new Error('rapier.mjs: embedded base64 WASM not found');
    const glue = src.replace(b64[0], 'yield(yield fetch(new URL("rapier.wasm",import.meta.url))).arrayBuffer()');
    const full = Buffer.from(b64[2], 'base64'), fullW = path.join(W, 'full.wasm'); writeFileSync(fullW, full);
    // reachability through the JS glue, by name
    const acorn = req('acorn'), walk = req('acorn-walk'), ast = acorn.parse(glue, { ecmaVersion: 'latest', sourceType: 'module' });
    const nodes = new Map(), add = (k, b) => (nodes.get(k) || nodes.set(k, []).get(k)).push(b), alias = new Map(), top = [];
    const collect = n0 => { const refs = new Set(), qi = new Set(); walk.full(n0, n => {
      if (n.type === 'Identifier') refs.add(n.name);
      else if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') { refs.add(n.property.name); if (n.object.type === 'Identifier') qi.add(n.object.name + '.' + n.property.name); }
      else if (n.type === 'MemberExpression' && n.computed && n.property.type === 'Literal') refs.add(String(n.property.value));
      else if (n.type === 'Property' && n.key.type === 'Identifier') refs.add(n.key.name);
    }); return { refs, qi }; };
    for (const st of ast.body) {
      if (st.type === 'ExportNamedDeclaration') { for (const s of st.specifiers || []) alias.set(s.exported.name, s.local.name); }
      else if (st.type === 'ClassDeclaration') { const cn = st.id.name; if (st.superClass) add(cn, collect(st.superClass)); for (const m of st.body.body) { if (m.kind === 'constructor' || m.type === 'StaticBlock' || (m.type === 'PropertyDefinition' && !m.static)) add(cn, collect(m)); else add(m.key.name ?? String(m.key.value), collect(m)); } }
      else if (st.type === 'FunctionDeclaration') add(st.id.name, collect(st));
      else if (st.type === 'VariableDeclaration') for (const d of st.declarations) { if (d.id.type === 'Identifier') add(d.id.name, collect(d)); else top.push(d); }
      else if (st.type !== 'ImportDeclaration') top.push(st);
    }
    const exportsOf = WebAssembly.Module.exports(new WebAssembly.Module(full)).map(e => e.name), exp = new Set(exportsOf);
    // the object holding the WASM exports = the identifier most often dotted with export names
    const cnt = new Map(); walk.full(ast, n => { if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && exp.has(n.property.name)) cnt.set(n.object.name, (cnt.get(n.object.name) || 0) + 1); });
    const QI = [...cnt].sort((a, b) => b[1] - a[1])[0][0];
    const roots = rapierNames(), seen = new Set(), keep = new Set(), q = [];
    const push = n => { if (!seen.has(n)) { seen.add(n); q.push(n); } }, take = b => { b.refs.forEach(push); for (const x of b.qi) if (x.startsWith(QI + '.')) keep.add(x.slice(QI.length + 1)); };
    roots.forEach(r => push(alias.get(r) || r)); top.forEach(t => take(collect(t)));
    while (q.length) for (const b of nodes.get(q.pop()) || []) take(b);
    const kept = exportsOf.filter(e => keep.has(e) || e === 'memory' || e.startsWith('__wbindgen'));
    writeFileSync(path.join(W, 'graph.json'), JSON.stringify(kept.map((e, i) => ({ name: 'e' + i, export: e, root: true }))));
    const pr = path.join(W, 'pruned.wasm'), pr3 = path.join(W, 'pruned3.wasm');
    sh(bin('wasm-metadce'), [...WASM_FEATURES, '-f', path.join(W, 'graph.json'), fullW, '-o', pr], { stdio: ['ignore', 'ignore', 'inherit'] });
    console.log('rapier', RAPIER + ': optimizing the pruned WASM (wasm-opt -O3, a few minutes)');
    sh(bin('wasm-opt'), [...WASM_FEATURES, '-O3', pr, '-o', pr3]);
    const best = [pr, pr3].map(f => readFileSync(f)).sort((a, b) => a.length - b.length)[0];
    // self-test: full vs pruned, bit for bit
    const dirs = ['full', 'pruned'].map(d => path.join(W, 'rt-' + d));
    dirs.forEach((d, i) => { mkdirSync(d); writeFileSync(path.join(d, 'rapier.mjs'), glue); writeFileSync(path.join(d, 'rapier.wasm'), i ? best : full); });
    const hs = dirs.map(d => execFileSync(process.execPath, [path.join(ROOT, 'tools/lib/rapiertest.mjs'), d], { encoding: 'utf8' }).trim());
    if (hs[0] !== hs[1]) throw new Error(`pruned Rapier differs from the full build (${hs[0]} vs ${hs[1]}): vendor/ left unchanged`);
    rmSync(rel('vendor/rapier'), { recursive: true, force: true }); mkdirSync(rel('vendor/rapier'));
    writeFileSync(rel('vendor/rapier/rapier.mjs'), glue); writeFileSync(rel('vendor/rapier/rapier.wasm'), best);
    writeFileSync(rel('vendor/rapier/roots.json'), JSON.stringify({ rapier: RAPIER, note: 'names js/rapier.js used when the WASM was pruned (tools/vendor.mjs)', roots }) + '\n');
    copyFileSync(path.join(P, 'LICENSE'), rel('vendor/rapier/LICENSE'));
    console.log(`rapier ${RAPIER}: ${kept.length} of ${exportsOf.length} exports kept, ${full.length} -> ${best.length} bytes, self-test ${hs[1]} identical`);
    setHash();
  } finally { rmSync(W, { recursive: true, force: true }); }
}
