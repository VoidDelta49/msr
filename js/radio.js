// In-game radio: station state, the music scheduler, the 📻 panel and its keys. js/radiogen.js composes the songs, js/radiosynth.js
// plays them; this file is the glue. Off by default (cfg.radio = 0); cfg.radio = 1..4 picks a generated station, 5 and up a LIVE one:
// a real Philippine public broadcaster's own webcast (which ones, and the rules, are js/radiolive.js), cfg.rlive = that station's
// directory id so the same one comes back next time. cfg.rvol is the volume.
// The radio feeds the game's master bus (audio.js bus()), so Sound off mutes it, the master volume scales it and a crash muffles it
// together with everything else. It plays on through pauses and the garage, quieter.
import { cfg, save } from './config.js';
import { S, ctx } from './state.js';
import { $, sstep } from './util.js';
import { bus, initAudio } from './audio.js';
import { STATIONS, makeSong, stepEvents, stationLabel } from './radiogen.js';
import { noiseBuffer, buildStation, createPlayer, tuneStatic } from './radiosynth.js';
import { API, QUERIES, clickUrl, pickLive, validList, PHcount } from './radiolive.js';

export const RAD = { say: null, cur: 0, title: '' }; // say: main.js hands in hud.js's say()
const LOOK = .6;      // seconds of music scheduled ahead of the audio clock
const LEVEL = 2.2;    // radio volume 1.0 = this much of the master bus: the stations are trimmed to about -19 dBFS RMS, so the default 60% lands near -17 dBFS, level with an idling engine (tools/radio.mjs --engine)
let AC = null, OUT = null, noise = null, R = null, last = 1, ui = '';
const NG = STATIONS.length; // stations 1..NG are generated, NG+1.. are live
export const LIVE1 = NG + 1;

// ---- live stations: the list (asked for the first time the radio is used, kept a day) ----
let L = [], LS = 0, APIH = '', failAt = -1e9, WHY = ''; // WHY: what to tell the player when there is no live station // LS: 0 not asked, 1 asking, 2 have the answer
const live = c => c > NG ? L[c - NG - 1] : null;
const https = u => location.protocol === 'https:' ? u.replace(/^http:/, 'https:') : u; // an http stream on an https page: the https address (the browser would upgrade it anyway)
const label = c => c > NG ? live(c).name : stationLabel(c - 1), tagOf = c => c > NG ? live(c).tag : STATIONS[c - 1].tag;
function gotLive(list, host) {
  L = list; APIH = host; LS = 2; ui = '';
  if ((cfg.radio | 0) > NG) { // the saved live station, wherever it is in today's list; the first one if it is gone
    const i = L.findIndex(s => s.id === cfg.rlive); cfg.radio = i >= 0 ? NG + 1 + i : L.length ? NG + 1 : 0;
    if (!L.length && RAD.say) RAD.say('Live PH: ' + WHY, 2600);
    save();
  }
}
function loadLive() {
  if (LS || performance.now() - failAt < 60000) return; LS = 1;
  try { const c = JSON.parse(localStorage.getItem('cpm.radio2') || 'null'), age = c ? Date.now() - c.at : -1; if (age >= 0 && age < 864e5 && validList(c.list) && c.list.length) return gotLive(c.list, API.includes(c.host) ? c.host : ''); } catch (e) { }
  (async () => {
    for (const h of API) {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 9000);
      try {
        const got = await Promise.all(QUERIES.map(q => fetch(h + q, { signal: ctl.signal }).then(r => r.ok ? r.json() : null).catch(() => null)));
        if (!got[0]) continue; // the main search failed on this mirror: the next one
        const rows = got.filter(Array.isArray).flat(), list = pickLive(rows);
        WHY = list.length ? '' : 'no public station streaming right now (' + PHcount(rows) + ' Philippine listings checked)';
        console.info('radio: live directory ' + h + ': ' + rows.length + ' listings, ' + PHcount(rows) + ' Philippine, public:', list.map(s => s.name + ' ' + s.url));
        if (list.length) try { localStorage.setItem('cpm.radio2', JSON.stringify({ at: Date.now(), host: h, list })); } catch (e) { }
        gotLive(list, h); if (!list.length) { failAt = performance.now(); LS = 0; } // ask again in a minute
        return;
      } catch (e) { } finally { clearTimeout(tm); }
    }
    WHY = navigator.onLine === false ? 'offline' : "can't reach the station directory (radio-browser.info)";
    console.warn('radio: live directory unreachable on every mirror', API);
    failAt = performance.now(); gotLive([], ''); LS = 0; // offline or the directory is down: ask again in a minute
  })();
}

// ---- live stations: playing one. The stream goes from the station's server to an <audio> element and nowhere else: not recorded,
// not cached, not sent on. First try is with CORS so the sound can join the game's master bus (master volume, crash muffle); a
// station that does not allow that plays through a plain element with its volume set by hand. ----
const LIVEGAIN = .6; // broadcast audio is processed hot (about -9 dBFS RMS): this puts it level with the generated stations
let LV = null, LG = null; const EL = [null, null], counted = new Set();
function el(i) {
  if (EL[i]) return EL[i];
  const a = EL[i] = new Audio(); a.preload = 'none';
  if (!i) { a.crossOrigin = 'anonymous'; LG = AC.createGain(); LG.gain.value = 0; AC.createMediaElementSource(a).connect(LG); LG.connect(OUT); }
  a.addEventListener('playing', () => { if (LV && LV.a === a) { LV.st = 'on'; if (APIH && !counted.has(LV.s.id)) { counted.add(LV.s.id); fetch(clickUrl(APIH, LV.s.id), { mode: 'no-cors' }).catch(() => { }); } } });
  a.addEventListener('waiting', () => { if (LV && LV.a === a && LV.st === 'on') { LV.st = 'tune'; LV.t = performance.now(); } });
  a.addEventListener('error', () => { if (LV && LV.a === a) liveFail(); });
  return a;
}
const quiet = a => { if (!a) return; try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) { } }; // drops the connection, so a stopped radio uses no data
function livePlay(i) {
  const a = el(i), s = LV.s; LV.a = a; LV.st = 'tune'; LV.t = performance.now(); a.src = https(s.url); a.volume = i ? 0 : 1;
  const p = a.play(); if (p) p.catch(e => {
    if (!LV || LV.s !== s || LV.a !== a || e.name !== 'NotAllowedError') return; // the browser wants a tap first (a saved station at start-up)
    LV.st = 'tap'; const again = () => { removeEventListener('pointerdown', again, true); removeEventListener('keydown', again, true); if (LV && LV.s === s && LV.st === 'tap') livePlay(i); };
    addEventListener('pointerdown', again, true); addEventListener('keydown', again, true);
  });
}
function liveFail() {
  const a = LV.a; LV.a = null; quiet(a);
  if (a === EL[0]) { LV.s.pl = 1; return livePlay(1); }
  LV.st = 'dead'; if (RAD.say) RAD.say('No signal · ' + LV.s.name, 1800);
}
function liveStart(s) { LV = { s, a: null, st: 'tune', t: 0 }; cfg.rlive = s.id; livePlay(s.pl ? 1 : 0); }
function liveStop() { if (!LV) return; const a = LV.a; LV = null; quiet(a); if (LG) { LG.gain.cancelScheduledValues(AC.currentTime); LG.gain.value = 0; LG._v = 0; } }
function liveTick(lvl) {
  if (LV.st === 'tune' && performance.now() - LV.t > 15000) return liveFail(); // nothing in 15 s
  const a = LV.a; if (!a) return;
  if (a === EL[0]) { const x = lvl * LIVEGAIN; if (Math.abs((LG._v ?? -1) - x) > 5e-4) { LG._v = x; LG.gain.setTargetAtTime(x, AC.currentTime, .12); } }
  else { const x = Math.min(1, lvl * LIVEGAIN * (cfg.vol ?? .8)); if (Math.abs(a.volume - x) > .004) a.volume = x; }
}

// ---- tuning ----
function stop(o) { if (!o) return; const t = AC.currentTime; o.st.out.gain.cancelScheduledValues(t); o.st.out.gain.setTargetAtTime(0, t, .04); setTimeout(() => o.st.stop(), 900); }
function setStation(n) {
  const t = AC.currentTime; stop(R); R = null; liveStop(); RAD.cur = n; RAD.title = '';
  tuneStatic(AC, OUT, noise, t, (cfg.rvol ?? .6) * LEVEL * .5); // a burst of static between stations, a click when it goes off
  if (!n) return;
  if (n > NG) { last = n; return liveStart(live(n)); }
  const st = buildStation(AC, n - 1, OUT, noise), song = makeSong(n - 1, Math.random() * 4294967296);
  R = { st, pl: createPlayer(AC, st, noise), song, step: 0, t: t + .3 }; st.setTempo(song.stepDur); RAD.title = song.title; last = n;
}
// next / previous station; wraps through Off (N: Off -> Isla -> Takbo -> Lo-Fi -> Radyo -> the live stations -> Off)
export function radioStep(d) {
  initAudio(); loadLive(); const n = NG + L.length + 1, c = (Math.min(cfg.radio | 0, n - 1) + d + n) % n; cfg.radio = c; if (c > NG) cfg.rlive = live(c).id; save();
  if (!c && !L.length && d > 0 && RAD.say) return RAD.say('Radio off · Live PH: ' + (LS === 1 ? 'still looking for stations…' : WHY || 'looking for stations…'), 2600); // stepped past the last generated station
  if (RAD.say) RAD.say(c ? (c > NG ? 'LIVE · ' : 'RADIO · ') + label(c) + ' · ' + tagOf(c) : 'Radio off', 1800);
}
function radioSet(c) { initAudio(); loadLive(); cfg.radio = c; if (c > NG) cfg.rlive = live(c).id; save(); if (RAD.say) RAD.say(c ? (c > NG ? 'LIVE · ' : 'RADIO · ') + label(c) : 'Radio off', 1500); }

// ---- the scheduler: runs every frame, music a little ahead of the audio clock ----
export function radioTick() {
  const b = bus(); if (!b) return; if (!AC) { AC = b.AC; OUT = b.out; noise = noiseBuffer(AC); }
  let want = cfg.sound ? cfg.radio | 0 : 0;
  if (want && !LS) loadLive(); // the radio is in use: find out which live stations are on the air, so N / ▶ can reach them
  if (want > NG) { if (LS !== 2) want = 0; else if (want > NG + L.length) want = cfg.radio = L.length ? NG + 1 : 0; } // a live station is picked but the list is not here yet
  if (want !== RAD.cur) setStation(want);
  if (!R && !LV) return panel();
  const now = AC.currentTime;
  // loudness: the volume knob, quieter at speed and on the throttle (the bike has to stay on top), low while a menu is up
  const v = Math.abs(S.v) || 0, duck = (1 - .25 * sstep(10, 40, v)) * (1 - .15 * (S.thrEff || 0)) * (ctx.paused ? .25 : ctx.GAR ? .6 : 1);
  if (LV) { liveTick((cfg.rvol ?? .6) * duck); return panel(); }
  const g = R.st.out.gain, lvl = (cfg.rvol ?? .6) * LEVEL * duck;
  if (g._v === undefined || Math.abs(g._v - lvl) > 5e-4) { g._v = lvl; g.setTargetAtTime(lvl, now, .12); }
  if (R.t < now - .1) R.t = now + .05; // the page stalled (shader compile, tab in the background): resume instead of racing to catch up
  while (R.t < now + LOOK) {
    const s = R.song;
    if (R.step >= s.total) { // song over: a short gap with the station's ident, then the next song
      R.pl.jingle(R.t + .3); R.song = makeSong(RAD.cur - 1, Math.random() * 4294967296); R.step = 0; R.t += 2.4; R.st.setTempo(R.song.stepDur); RAD.title = R.song.title; continue;
    }
    const t = R.t + (R.step & 1 ? s.swing * s.stepDur : 0) + (Math.random() - .5) * .008;
    for (const ev of stepEvents(s, R.step)) R.pl.play(ev, Math.max(t, now), s.stepDur);
    if ((RAD.cur === 3 && Math.random() < .035) || (RAD.cur === 4 && Math.random() < .014)) R.pl.crackle(R.t + Math.random() * s.stepDur, RAD.cur === 3 ? .05 : .11); // AM static and vinyl crackle
    R.step++; R.t += s.stepDur;
  }
  panel();
}

// ---- the 📻 button + panel (same pattern as the HUD eye button in options.js) ----
const bR = $('bRad'), qR = $('radQ');
function panel() {
  const c = RAD.cur, wait = !c && cfg.sound && (cfg.radio | 0) > NG, key = c + '|' + RAD.title + '|' + (cfg.rvol ?? .6) + '|' + !!cfg.sound + '|' + (LV ? LV.st : '') + wait; if (key === ui) return; ui = key;
  const LT = { on: '● LIVE · ', tune: 'Tuning in… · ', tap: 'Tap anywhere to listen · ', dead: 'No signal right now · ' };
  $('radN').textContent = c ? label(c) : wait ? 'Live PH' : 'Radio off';
  $('radT').textContent = c > NG ? (LV ? LT[LV.st] : '') + tagOf(c) : c ? '♪ ' + RAD.title + ' · ' + tagOf(c) : wait ? 'Looking for live stations…' : 'N or ▶ to tune in';
  $('radPow').textContent = c ? 'OFF' : 'ON'; $('radPow').classList.toggle('on', !!c); bR.classList.toggle('on', !!c);
  const vs = $('radVs'), vo = $('radVo'), p = Math.round((cfg.rvol ?? .6) * 100); if (document.activeElement !== vs) vs.value = p; vo.textContent = p + '%';
}
{
  const shut = () => { qR.hidden = true; bR.setAttribute('aria-expanded', 'false'); };
  bR.onclick = e => { e.stopPropagation(); const hq = $('hudQ'); if (hq) { hq.hidden = true; $('bHud').setAttribute('aria-expanded', 'false'); } qR.hidden = !qR.hidden; bR.setAttribute('aria-expanded', String(!qR.hidden)); ui = ''; panel(); };
  $('radPrev').onclick = () => radioStep(-1); $('radNext').onclick = () => radioStep(1);
  $('radPow').onclick = () => radioSet(cfg.radio ? 0 : Math.min(last, NG + L.length) || 1);
  $('radVs').oninput = e => { cfg.rvol = +e.target.value / 100; save(); ui = ''; panel(); };
  addEventListener('pointerdown', e => { if (!qR.hidden && !qR.contains(e.target) && !bR.contains(e.target)) shut(); }, true);
  addEventListener('keydown', e => { if (e.code === 'Escape' && !qR.hidden) shut(); });
  $('bHud').addEventListener('click', shut); // the HUD panel and the radio panel share the spot under the top bar
}
