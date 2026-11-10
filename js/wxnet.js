// Weather (11.99c): where the live snapshot comes from. No three.js (the main menu uses it before the game is loaded).
//  - in a multiplayer room the relay sends it (`wx` after `hi`, then every 15 minutes): net.js hands it to wxFromRoom()
//  - riding solo: GET <relay>/wx when the page starts and a little after every 15-minute step (under 100 requests a day).
//    Not asked while a room is feeding us, nor while Options > Weather is a fixed weather.
//  - the last snapshot is kept in localStorage, so a reload (or starting offline) shows the same sky until it is too old
//    (weather.js gives a snapshot up after 2.5 hours and goes back to clear).
import { cfg, MP_URL } from './config.js';
import { ctx } from './state.js';
import { cleanWx, wxLive } from './weather.js';

const KEY = 'cpmwx', STEP = 900e3;
let got = 0, timer = 0, busy = false, old = false; // old: this relay has no /wx (not redeployed since 11.99c): stop asking until the next load
function take(m) { const s = cleanWx(m); if (!s) return false; wxLive(s); got = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } return true; }
try { const s = cleanWx(JSON.parse(localStorage.getItem(KEY) || 'null')); if (s) wxLive(s); } catch (e) { }
export const wxFromRoom = m => take(m);
export async function wxPoll() {
  if (busy || old || (cfg.wx ?? 'live') !== 'live' || navigator.onLine === false) return;
  const N = ctx.NET; if (N && N.st === 'on' && Date.now() - got < STEP + 3e5) return; // the room is sending it
  busy = true;
  try { const r = await fetch(String(cfg.mpUrl || MP_URL).replace(/\/+$/, '') + '/wx', { signal: AbortSignal.timeout(8000) }); if (r.ok) take(await r.json()); else if (r.status === 404) old = true; }
  catch (e) { /* offline, relay down or not redeployed yet: keep what we have */ }
  busy = false;
}
export function wxStart() {
  if (timer) return; wxPoll();
  const next = () => { timer = setTimeout(() => { wxPoll(); next(); }, STEP - Date.now() % STEP + 7e4 + Math.random() * 3e4); }; next(); // 70-100 s into each step: the relay's cache has the new data
  const late = () => { if (document.visibilityState !== 'hidden' && Date.now() - got > STEP + 2e5) wxPoll(); };
  addEventListener('online', late); document.addEventListener('visibilitychange', late);
}
