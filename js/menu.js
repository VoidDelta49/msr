// Page entry: the main menu. Plain DOM + the small settings modules only, so the page is up in a blink.
// three.js, Rapier and the island (main.js and everything it imports) are fetched in the background once the page has
// loaded, and only parsed/built when the player taps PLAY. The same menu is the pause menu in game (Esc / ☰).
import { bikeCard } from './bikecard.js';
import { cfg, save, BUILD, MP_URL, AA_MODES } from './config.js';
import { $ } from './util.js';
import { ctx } from './state.js';
import { O, openOpts } from './options.js';

// No browser context menu anywhere: right-click, touch-and-hold, long-press on images/links and native drag all do nothing.
// Text-entry fields keep theirs so name / room code / server URL can still be pasted.
const TXT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=file]),textarea,[contenteditable=""],[contenteditable="true"]';
const keepNative = e => e.target instanceof Element && e.target.closest(TXT);
for (const t of ['contextmenu', 'dragstart']) addEventListener(t, e => { if (!keepNative(e)) e.preventDefault(); }, { capture: true });
addEventListener('selectstart', e => { if (!keepNative(e) && !(e.target instanceof Element && e.target.closest('#oLog'))) e.preventDefault(); }, { capture: true });

const IM = JSON.parse(document.querySelector('script[type=importmap]').textContent).imports;
// heavy CDN files with their decompressed sizes (the progress bar counts decompressed stream bytes; versions are pinned)
const LIBS = [[IM['three/webgpu'], 2284850], [IM['three/webgpu'].replace('three.webgpu.js', 'three.core.js'), 1458113], [IM['three/tsl'], 36854], [IM['@dimforge/rapier3d-compat'], 230867], [IM['@dimforge/rapier3d-compat'].replace('.mjs', '.wasm'), 3082103],
  [IM['three/addons/'] + 'utils/BufferGeometryUtils.js', 37712], ...(AA_MODES[cfg.aa].fx || AA_MODES[cfg.aa].ms ? [[IM['three/addons/'] + 'tsl/display/FXAANode.js', 9450]] : [])];
// our own modules too (small, not counted in the bar); fetched into the HTTP cache so import() doesn't wait on them
const OWN = Object.entries(IM).filter(([k]) => k.startsWith('./js/') && !/menu|config|util|state|options/.test(k)).map(([, u]) => [u, 0]);
const TOTAL = LIBS.reduce((a, l) => a + l[1], 0);
let got = 0, pre = null, G = null, busy = false;

function prefetch() {
  return pre || (pre = Promise.all([...LIBS, ...OWN, ['data/map/island.json?v=' + BUILD, 0]].map(async ([url, n]) => {
    const r = await fetch(url); if (!r.ok) throw new Error(url.split('/').pop() + ': HTTP ' + r.status);
    let seen = 0; const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; const add = Math.max(0, Math.min(value.length, n - seen)); seen += value.length; if (add) { got += add; prog(); } }
    if (seen < n) { got += n - seen; prog(); }
  })).catch(e => { pre = null; throw e; }));
}
function prog() { const f = got / TOTAL; $('mPre').style.transform = `scaleX(${f})`; if (!$('mLoad').hidden && busy === 'dl') bar(f * .7, 'Downloading the game', Math.round(f * 100) + '% · ' + (got / 1048576).toFixed(1) + ' / ' + (TOTAL / 1048576).toFixed(1) + ' MB'); }
function bar(f, stage, det = '') { $('mFill').style.transform = `scaleX(${f})`; $('mStage').textContent = stage; $('mDet').textContent = det; }
// main.js reports its own stages through this while it loads
window.__cpmLoad = (stage, f) => bar(f, stage);
const frames = n => new Promise(r => { const f = () => --n ? requestAnimationFrame(f) : r(); requestAnimationFrame(f); });

/* ---------- panes ---------- */
const PANES = ['mMain', 'mBikes', 'mMPP', 'mHelpP', 'mNewsP', 'mLoad'];
function show(id) { for (const p of PANES) $(p).hidden = p !== id; }
$('menu').onclick = e => { if (e.target.closest('[data-back]')) show('mMain'); };
$('mHelp').onclick = () => show('mHelpP');
$('mOpt').onclick = () => openOpts();
$('mFoot').textContent = 'Build ' + BUILD;

/* ---------- patch notes + update check ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let seen = ''; try { seen = localStorage.getItem('cpm-seen') || ''; } catch (e) {}
if (seen !== BUILD) $('mNewsN').textContent = 'NEW';
let logP = null;
function news() {
  return logP || (logP = fetch('data/changelog.json?v=' + BUILD).then(r => r.json()).then(L => {
    $('mLog').innerHTML = L.map(e => `<div><h3>${esc(e.v)}${e.d ? `<small>${esc(e.d)}</small>` : ''}</h3><ul>${e.t.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('');
  }).catch(e => { logP = null; $('mLog').textContent = "Couldn't load the patch notes (offline?)."; }));
}
$('mNews').onclick = () => {
  show('mNewsP'); news(); $('mNewsN').textContent = '';
  try { localStorage.setItem('cpm-seen', BUILD); } catch (e) {}
};
// update check: reads BUILD out of a fresh js/config.js (no-store; ?chk keeps an old service worker's cache out of it)
let newer = '', lastChk = 0;
async function checkUpdate() {
  if (Date.now() - lastChk < 60000 || !navigator.onLine) return; lastChk = Date.now();
  try {
    const r = await fetch('js/config.js?chk=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
    const m = (await r.text()).match(/BUILD\s*=\s*'([^']+)'/);
    if (m && m[1] !== BUILD) { newer = m[1]; $('mUpd').hidden = false; $('mUpdN').textContent = newer; }
  } catch (e) { /* offline: try again later */ }
}
$('mUpd').onclick = async () => {
  $('mUpd').disabled = true; $('mUpd').firstChild.textContent = 'UPDATING...';
  try {
    for (const g of await navigator.serviceWorker.getRegistrations()) await g.unregister();
    for (const k of await caches.keys()) if (k.startsWith('cpm-')) await caches.delete(k);
    await Promise.all(['index.html', './'].map(u => fetch(u, { cache: 'reload' }))); // refresh the HTTP-cached page so the reload gets the new ?v=
  } catch (e) { console.warn('update: ' + e.message); }
  location.reload();
};
addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
const TIPS = ['Manual bikes: pull the clutch before you shift, and ease it out to launch.', 'The scooter has Idling Stop: hold the brake and press START to wake it.', 'Low on fuel? The station is next to the parking lot, the red dot on the minimap.', 'Graphics too heavy? Options > Quality > Low, or a Retro res cap.', 'Tough Biker mode (Options) makes you crash-proof.', 'The airstrip in the north-west is 910 m of flat concrete for top-speed runs.', 'The GARAGE is a showroom: swap parts, watch the dyno and stats change, then save builds or export them to a file.', 'Quests are scattered around the island: ride into a beacon and hold still. Red-outlined ones need a specific bike and switch you to it.'];

/* ---------- bikes (just JSON, no 3D needed) ---------- */
let BIKES = [];
async function loadBikes() {
  const ids = await (await fetch('data/bikes/index.json?v=' + BUILD)).json();
  BIKES = await Promise.all(ids.map(id => fetch(`data/bikes/${id}.json?v=${BUILD}`).then(r => r.json())));
  if (!BIKES.some(b => b.id === cfg.bike)) cfg.bike = BIKES[0].id;
  cards();
}
function cards() {
  const cur = BIKES.find(b => b.id === cfg.bike); $('mBikeN').textContent = cur ? cur.short : '';
  $('mCards').innerHTML = BIKES.map(b => bikeCard(b, b.id === cfg.bike, 'data-id')).join('');
}
$('mBike').onclick = () => { show('mBikes'); const on = $('mCards').querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' }); };
$('mCards').onclick = e => {
  const c = e.target.closest('.bc'); if (!c) return;
  if (c.dataset.id !== cfg.bike) { if (G) G.switchBike(c.dataset.id); else { cfg.bike = c.dataset.id; save(); } }
  cards(); show('mMain');
};
loadBikes().catch(e => console.warn('bike list: ' + e.message));

/* ---------- multiplayer (net.js does the work once the game has loaded) ---------- */
const mpIn = { name: $('mpName'), room: $('mpRoom'), url: $('mpUrl') };
mpIn.name.value = cfg.name; mpIn.room.value = cfg.room; mpIn.url.value = cfg.mpUrl || ''; if (MP_URL) mpIn.url.placeholder = MP_URL; // blank = the built-in server (MP_URL); only needed to point at another relay
if (!MP_URL && !cfg.mpUrl) $('mpUrl').parentElement.open = true;
const ST = { off: '', conn: 'Connecting…', retry: 'Reconnecting…' };
function mpUI() {
  const N = ctx.NET, on = N && N.st !== 'off';
  $('mpSt').textContent = N && N.st === 'on' ? `In room ${N.room} · ${N.peers.size + 1}/${N.max} riders` : on ? N.note || ST[N.st] : (N && N.err) || (ctx.mpWant ? 'Joins when the game has loaded' : '');
  $('mpSt').classList.toggle('bad', !on && !!(N && N.err)); $('mpLeave').hidden = !on; $('mpJoin').hidden = $('mpNew').hidden = on;
  $('mMPN').textContent = N && N.st === 'on' ? N.room + ' · ' + (N.peers.size + 1) : '';
}
ctx.onNet = mpUI;
mpIn.room.oninput = () => { mpIn.room.value = mpIn.room.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
function mpGo(room) {
  const name = mpIn.name.value.trim().slice(0, 16) || 'Rider', url = mpIn.url.value.trim() || MP_URL;
  if (navigator.onLine === false) { $('mpSt').textContent = "You're offline: multiplayer needs a connection"; return; }
  if (!/^[A-Z0-9]{6,8}$/.test(room)) { $('mpSt').textContent = 'Room codes are 6-8 letters or numbers'; return; }
  if (!/^(https?|wss?):\/\//.test(url)) { $('mpSt').textContent = MP_URL ? 'Server address must start with https://' : 'Set the server address first (Server, below)'; $('mpUrl').parentElement.open = true; return; }
  Object.assign(cfg, { name, room, mpUrl: mpIn.url.value.trim() === MP_URL ? '' : mpIn.url.value.trim() }); save(); mpIn.room.value = room;
  if (G) { G.mpJoin(room, name, url); mpUI(); } else { ctx.mpWant = { room, name, url }; mpUI(); play(); }
}
$('mMP').onclick = () => { show('mMPP'); mpUI(); };
$('mpJoin').onclick = () => mpGo(mpIn.room.value);
$('mpNew').onclick = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r = ''; const rnd = crypto.getRandomValues(new Uint32Array(6)); for (let i = 0; i < 6; i++) r += A[rnd[i] % A.length]; mpGo(r); };
$('mpLeave').onclick = () => { if (G) G.mpLeave(); mpUI(); };

/* ---------- play / pause ---------- */
function goFS() { const d = document.documentElement; if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { })).catch(() => { }); }
// the audio context must be created inside the tap; audio.js picks it up when the game has loaded
function unlockAudio() {
  if (window.__cpmAC) return window.__cpmAC.resume();
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { }
  try { window.__cpmAC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); window.__cpmAC.resume(); } catch (e) { }
}
function hideMenu() { $('menu').hidden = true; ctx.MENU = false; document.body.classList.remove('menu'); }
export function openMenu() {
  if (!G || ctx.MENU || ctx.OPT || ctx.GAR) return;
  ctx.MENU = true; ctx.paused = true; document.body.classList.add('menu'); cards(); show('mMain'); $('menu').hidden = false; checkUpdate();
}
async function play() {
  goFS(); unlockAudio();
  if (G) { hideMenu(); G.play(); return; }
  if (busy) return; busy = 'dl'; show('mLoad'); $('mTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  try {
    prog(); await prefetch().catch(e => console.warn('prefetch: ' + e.message)); // import() below retries anything that failed
    busy = 'build'; bar(.72, 'Building the island'); await frames(2); // let that paint: the island build blocks the thread
    G = await import('./main.js');
    document.body.classList.add('ingame'); $('mPlayT').textContent = 'RESUME'; $('mPre').hidden = true; busy = false;
    hideMenu(); G.play();
  } catch (e) {
    busy = false; console.error(e); bar(0, "Couldn't load the game", e.message || String(e));
    $('mTip').innerHTML = '<button class="mb sm" id="mRetry">RETRY</button>'; $('mRetry').onclick = () => location.reload();
  }
}
$('mPlay').onclick = play;
$('bMenu').onclick = openMenu;
addEventListener('keydown', e => {
  if (e.code !== 'Escape' || ctx.OPT || ctx.GAR) return; // Esc in options/garage is handled there
  if (!ctx.MENU) return openMenu();
  if (!$('mBikes').hidden || !$('mHelpP').hidden || !$('mMPP').hidden || !$('mNewsP').hidden) show('mMain'); else if (G) play();
});
ctx.MENU = true; document.body.classList.add('menu');
// start downloading once the menu is up (doesn't block anything: nothing is parsed until PLAY)
if (document.readyState === 'complete') setTimeout(bg, 100); else addEventListener('load', () => setTimeout(bg, 100));
function bg() { checkUpdate(); prefetch().catch(e => console.warn('prefetch: ' + e.message)).finally(offline); }
// offline support (sw.js): registered once the downloads are done so the two don't compete; off on localhost unless ?sw
function offline() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || (/^(localhost|127\.)/.test(location.hostname) && !/[?&]sw\b/.test(location.search))) return;
  const ok = () => { $('mFoot').textContent = 'Build ' + BUILD + ' · works offline'; };
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'cpm-offline-ready') ok(); });
  if (navigator.serviceWorker.controller) ok();
  navigator.serviceWorker.register('sw.js?v=' + BUILD).catch(e => console.warn('sw: ' + e.message));
}
