// Offline support: precaches the whole single-player game (page, modules, vendored libraries, data, audio worklet) so it
// runs with no connection after one online visit. Registered as sw.js?v=BUILD (js/menu.js), so every release is a new
// worker with its own cache; the file list is read from index.html (its importmap + tags), so there is nothing to keep in sync.
// Multiplayer needs the network and is not cached (WebSockets never pass through a service worker anyway).
const V = new URL(self.location.href).searchParams.get('v') || '0';
const CACHE = 'cpm-' + V;
const abs = u => new URL(u, self.registration.scope).href;

async function files() {
  const r = await fetch(new Request(abs('index.html'), { cache: 'reload' }));
  if (!r.ok) throw new Error('index.html: HTTP ' + r.status);
  const html = await r.clone().text();
  const urls = new Set();
  const im = html.match(/<script type="importmap">([\s\S]*?)<\/script>/), map = im ? JSON.parse(im[1]).imports : {};
  for (const u of Object.values(map)) if (!u.endsWith('/')) urls.add(abs(u));
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) if (!/^(https?:)?\/\//.test(m[1]) && !m[1].startsWith('data:')) urls.add(abs(m[1]));
  urls.add(abs('js/engine-worklet.js?v=' + V));
  if (map['@dimforge/rapier3d-compat']) urls.add(abs(map['@dimforge/rapier3d-compat'].replace('.mjs', '.wasm'))); // fetched by rapier.mjs at init
  urls.add(abs('data/map/island.json?v=' + V));
  const ix = abs('data/bikes/index.json?v=' + V); urls.add(ix);
  for (const id of await (await fetch(ix)).json()) urls.add(abs(`data/bikes/${id}.json?v=${V}`));
  // files reached through a prefix entry ("three/addons/": ...) aren't listed in the importmap: find them in our own modules
  const pre = map['three/addons/'];
  if (pre) for (const u of [...urls]) if (/\/js\/[^/]+\.js\?/.test(u)) {
    const src = await (await fetch(u)).text();
    for (const m of src.matchAll(/three\/addons\/([\w\/.-]+\.js)/g)) urls.add(abs(pre + m[1]));
  }
  return { urls: [...urls], page: r };
}

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CACHE), { urls, page } = await files();
  await c.put(abs('index.html'), page.clone()); await c.put(abs('./'), page);
  for (let i = 0; i < urls.length; i += 6) await Promise.all(urls.slice(i, i + 6).map(async u => {
    const r = await fetch(new Request(u, { cache: 'reload' }));
    if (!r.ok) throw new Error(u + ': HTTP ' + r.status); // any miss fails the install: never a half-filled cache
    await c.put(u, r);
  }));
  for (const cl of await self.clients.matchAll({ includeUncontrolled: true })) cl.postMessage('cpm-offline-ready');
  self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('cpm-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const q = e.request;
  if (q.method !== 'GET' || new URL(q.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (q.mode === 'navigate') { // page: newest when online (4 s), the cached copy when not
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(q, { signal: ctl.signal }); clearTimeout(t); return r;
      } catch (err) { return (await c.match(abs('index.html'))) || Response.error(); }
    }
    const hit = await c.match(q);
    if (hit) return hit;
    try { const r = await fetch(q); if (r.ok) c.put(q, r.clone()); return r; }
    catch (err) { return (await c.match(q, { ignoreSearch: true })) || Response.error(); }
  })());
});
