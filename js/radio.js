// In-game radio: station state, the music scheduler, the 📻 panel and its keys. js/radiogen.js composes the songs, js/radiosynth.js
// plays them; this file is the glue. Off by default (cfg.radio = 0); cfg.radio = 1..4 picks a station, cfg.rvol is its volume.
// The radio feeds the game's master bus (audio.js bus()), so Sound off mutes it, the master volume scales it and a crash muffles it
// together with everything else. It plays on through pauses and the garage, quieter.
import { cfg, save } from './config.js';
import { S, ctx } from './state.js';
import { $, sstep } from './util.js';
import { bus, initAudio } from './audio.js';
import { STATIONS, makeSong, stepEvents, stationLabel } from './radiogen.js';
import { noiseBuffer, buildStation, createPlayer, tuneStatic } from './radiosynth.js';

export const RAD = { say: null, cur: 0, title: '' }; // say: main.js hands in hud.js's say()
const LOOK = .6;      // seconds of music scheduled ahead of the audio clock
const LEVEL = 2.2;    // radio volume 1.0 = this much of the master bus: the stations are trimmed to about -19 dBFS RMS, so the default 60% lands near -17 dBFS, level with an idling engine (tools/radio.mjs --engine)
let AC = null, OUT = null, noise = null, R = null, last = 1, ui = '';

// ---- tuning ----
function stop(o) { if (!o) return; const t = AC.currentTime; o.st.out.gain.cancelScheduledValues(t); o.st.out.gain.setTargetAtTime(0, t, .04); setTimeout(() => o.st.stop(), 900); }
function setStation(n) {
  const t = AC.currentTime; stop(R); R = null; RAD.cur = n; RAD.title = '';
  tuneStatic(AC, OUT, noise, t, (cfg.rvol ?? .6) * LEVEL * .5); // a burst of static between stations, a click when it goes off
  if (!n) return;
  const st = buildStation(AC, n - 1, OUT, noise), song = makeSong(n - 1, Math.random() * 4294967296);
  R = { st, pl: createPlayer(AC, st, noise), song, step: 0, t: t + .3 }; st.setTempo(song.stepDur); RAD.title = song.title; last = n;
}
// next / previous station; wraps through Off (N: Off -> Isla -> Takbo -> Lo-Fi -> Radyo -> Off)
export function radioStep(d) {
  initAudio(); const n = STATIONS.length + 1, c = ((cfg.radio | 0) + d + n) % n; cfg.radio = c; save();
  if (RAD.say) RAD.say(c ? 'RADIO · ' + stationLabel(c - 1) + ' · ' + STATIONS[c - 1].tag : 'Radio off', 1800);
}
function radioSet(c) { initAudio(); cfg.radio = c; save(); if (RAD.say) RAD.say(c ? 'RADIO · ' + stationLabel(c - 1) : 'Radio off', 1500); }

// ---- the scheduler: runs every frame, music a little ahead of the audio clock ----
export function radioTick() {
  const b = bus(); if (!b) return; if (!AC) { AC = b.AC; OUT = b.out; noise = noiseBuffer(AC); }
  const want = cfg.sound ? cfg.radio | 0 : 0;
  if (want !== RAD.cur) setStation(want);
  if (!R) return panel();
  const now = AC.currentTime;
  // loudness: the volume knob, quieter at speed and on the throttle (the bike has to stay on top), low while a menu is up
  const v = Math.abs(S.v) || 0, duck = (1 - .25 * sstep(10, 40, v)) * (1 - .15 * (S.thrEff || 0)) * (ctx.paused ? .25 : ctx.GAR ? .6 : 1), g = R.st.out.gain, lvl = (cfg.rvol ?? .6) * LEVEL * duck;
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
  const c = RAD.cur, key = c + '|' + RAD.title + '|' + (cfg.rvol ?? .6) + '|' + !!cfg.sound; if (key === ui) return; ui = key;
  $('radN').textContent = c ? stationLabel(c - 1) : 'Radio off'; $('radT').textContent = c ? '♪ ' + RAD.title + ' · ' + STATIONS[c - 1].tag : 'N or ▶ to tune in';
  $('radPow').textContent = c ? 'OFF' : 'ON'; $('radPow').classList.toggle('on', !!c); bR.classList.toggle('on', !!c);
  const vs = $('radVs'), vo = $('radVo'), p = Math.round((cfg.rvol ?? .6) * 100); if (document.activeElement !== vs) vs.value = p; vo.textContent = p + '%';
}
{
  const shut = () => { qR.hidden = true; bR.setAttribute('aria-expanded', 'false'); };
  bR.onclick = e => { e.stopPropagation(); const hq = $('hudQ'); if (hq) { hq.hidden = true; $('bHud').setAttribute('aria-expanded', 'false'); } qR.hidden = !qR.hidden; bR.setAttribute('aria-expanded', String(!qR.hidden)); ui = ''; panel(); };
  $('radPrev').onclick = () => radioStep(-1); $('radNext').onclick = () => radioStep(1);
  $('radPow').onclick = () => radioSet(cfg.radio ? 0 : last);
  $('radVs').oninput = e => { cfg.rvol = +e.target.value / 100; save(); ui = ''; panel(); };
  addEventListener('pointerdown', e => { if (!qR.hidden && !qR.contains(e.target) && !bR.contains(e.target)) shut(); }, true);
  addEventListener('keydown', e => { if (e.code === 'Escape' && !qR.hidden) shut(); });
  $('bHud').addEventListener('click', shut); // the HUD panel and the radio panel share the spot under the top bar
}
