#!/usr/bin/env node
// Tiny static server (the game must be served over http, ES modules don't load from file://).
//   node tools/serve.mjs [port=8080]        Ctrl-C to stop. Prints the URL. Correct MIME for .mjs/.wasm/.json, no caching.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/headless.mjs';

const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
export function serve(port = 8080) {
  const srv = createServer(async (q, r) => {
    try {
      let p = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (!p.startsWith(ROOT)) throw 0;
      if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html');
      r.writeHead(200, { 'Content-Type': T[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(await readFile(p));
    } catch { r.writeHead(404); r.end('not found'); }
  });
  return new Promise(res => srv.listen(port, () => res(srv)));
}
if (process.argv[1]?.endsWith('serve.mjs')) { const port = +process.argv[2] || 8080; await serve(port); console.log(`http://localhost:${port}/`); }
