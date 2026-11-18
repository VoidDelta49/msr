#!/usr/bin/env node
// Tiny static server (the game must be served over http, ES modules don't load from file://).
//   node tools/serve.mjs [port=8080]        Ctrl-C to stop. Prints the URL. Correct MIME for .mjs/.wasm/.json, no caching.
// The Model Maker (maker/model.html) saves with PUT /data/models/<id>.json: the file + data/models/index.json. Nothing else is writable.
import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import { mdlProblems } from '../js/mdl.js';
import path from 'node:path';
import { ROOT } from './lib/headless.mjs';

const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
async function putModel(q, r) {
  const id = /^\/data\/models\/([a-z0-9_-]{1,32})\.json$/.exec(new URL(q.url, 'http://x').pathname)?.[1], no = (c, t) => { r.writeHead(c); r.end(t); };
  if (!id) return no(403, 'only data/models/<id>.json');
  let body = ''; for await (const c of q) { body += c; if (body.length > 4e6) return no(413, 'too big'); }
  let m; try { m = JSON.parse(body); } catch { return no(400, 'not JSON'); }
  const bad = m.id === id ? mdlProblems(m) : ['id does not match the file name']; if (bad.length) return no(400, bad.join('\n'));
  const dir = path.join(ROOT, 'data/models'); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, id + '.json'), body);
  const ids = (await readdir(dir)).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.slice(0, -5)).sort();
  await writeFile(path.join(dir, 'index.json'), JSON.stringify(ids) + '\n'); no(200, 'saved');
}
export function serve(port = 8080) {
  const srv = createServer(async (q, r) => {
    if (q.method === 'PUT') return putModel(q, r);
    try {
      let p = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!p.startsWith(ROOT)) throw 0;
      if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html');
      r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(await readFile(p));
    } catch { r.writeHead(404); r.end('not found'); }
  });
  return new Promise(res => srv.listen(port, () => res(srv)));
}
if (process.argv[1]?.endsWith('serve.mjs')) { const port = +process.argv[2] || 8080; await serve(port); console.log(`http://localhost:${port}/`); }
