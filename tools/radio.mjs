#!/usr/bin/env node
// Radio checks. Part 1 (Node only, ~1 s, part of test.mjs): the song generator (js/radiogen.js) for every station x many seeds: notes in
// range and in key, melody leaps sane, chord/bass/drum layers where the plan says, same seed = same song, different seeds = different
// songs, fade-out on the last section, event density bounded. Part 2 (needs Chrome, skips without it; --render): renders each station
// offline in headless Chrome from the real radiogen.js + radiosynth.js and checks levels (no NaN, no clipping, no silence, loudness equal
// across stations within 2 dB). `--detail` also prints each instrument alone, `--wav dir` writes 30 s of every station as a .wav.
//   node tools/radio.mjs [--render] [--detail] [--wav dir] [--seeds N]
import { STATIONS, SCALES, makeSong, stepEvents, songSeconds } from '../js/radiogen.js';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const a = process.argv.slice(2), has = k => a.includes(k), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const fails = [], SEEDS = +opt('--seeds', 12);
const bad = (m) => { if (fails.length < 40) fails.push(m); };
const INSTR = new Set(['kick', 'snare', 'clap', 'brush', 'hat', 'ohat', 'bass', 'pad', 'rhodes', 'skank', 'organ', 'arp', 'lead']);
const LAYER = { c: ['pad', 'rhodes'], b: ['bass'], g: ['skank', 'organ'], d: ['kick', 'snare', 'clap', 'brush', 'hat', 'ohat'], a: ['arp'], l: ['lead'] };

/* ---------- part 1: the generator ---------- */
let songs = 0, events = 0;
for (let si = 0; si < STATIONS.length; si++) {
  const st = STATIONS[si], titles = new Set(), sigs = new Set();
  for (let k = 0; k < SEEDS; k++) {
    const seed = 1000 + k * 7919 + si, song = makeSong(si, seed), tag = `${st.id}#${seed}`; songs++;
    if (!song.title || /undefined/.test(song.title)) bad(`${tag}: bad title "${song.title}"`);
    if (song.bpm < st.bpm[0] || song.bpm > st.bpm[1]) bad(`${tag}: bpm ${song.bpm} outside ${st.bpm}`);
    const secs = songSeconds(song); if (secs < 90 || secs > 220) bad(`${tag}: song length ${secs.toFixed(0)} s (want 90-220)`);
    const same = makeSong(si, seed); if (JSON.stringify(same) !== JSON.stringify(song)) bad(`${tag}: makeSong is not deterministic`);
    if (stepEvents(song, -1).length || stepEvents(song, song.total).length) bad(`${tag}: events outside the song`);
    const scale = SCALES[st.mode], inKey = m => scale.includes(((m - song.key) % 12 + 12) % 12), sig = [];
    let leads = 0, prev = null, maxDen = 0, drumsInFirst = 0, fadeFirst = 0, fadeLast = 0, bassN = 0;
    for (let step = 0; step < song.total; step++) {
      const ev = stepEvents(song, step), bar = step / song.spb | 0, sec = bar / song.secBars | 0, lay = song.plan[sec]; maxDen = Math.max(maxDen, ev.length); events += ev.length;
      for (const e of ev) {
        if (!INSTR.has(e.i)) bad(`${tag}: unknown instrument ${e.i}`);
        if (!(e.v >= 0 && e.v <= 1) || !Number.isFinite(e.v)) bad(`${tag}: step ${step} ${e.i} velocity ${e.v}`);
        if (!(e.d >= 1) || !Number.isInteger(e.d)) bad(`${tag}: step ${step} ${e.i} length ${e.d}`);
        const ms = e.n || (e.m != null ? [e.m] : []); for (const m of ms) if (!Number.isInteger(m) || m < 28 || m > 96) bad(`${tag}: step ${step} ${e.i} note ${m} out of range`);
        const need = Object.keys(LAYER).find(l => LAYER[l].includes(e.i) && !(e.i === 'snare' && 0)); if (need && !lay.includes(need)) bad(`${tag}: step ${step} ${e.i} played but layer '${need}' is not in section ${sec} (${lay})`);
        if (e.i === 'lead') { leads++; if (!inKey(e.m)) bad(`${tag}: lead note ${e.m} not in the ${st.mode} scale of ${song.key}`); if (prev != null && Math.abs(e.m - prev) > 12) bad(`${tag}: lead leap of ${e.m - prev} at step ${step}`); prev = e.m; }
        if (e.i === 'bass') { bassN++; if (e.m < 30 || e.m > 56) bad(`${tag}: bass note ${e.m}`); }
        if (sec === 0 && ['kick', 'snare', 'clap', 'hat'].includes(e.i)) drumsInFirst++;
        if (sec === song.plan.length - 1) { if (bar % song.secBars === 0) fadeFirst = Math.max(fadeFirst, e.v); if (bar % song.secBars === song.secBars - 1) fadeLast = Math.max(fadeLast, e.v); }
      }
      if (step % 5 === 0) sig.push(ev.map(e => e.i + (e.m ?? e.n?.[0] ?? '')).join(','));
    }
    if (maxDen > 14) bad(`${tag}: ${maxDen} events on one step`);
    if (drumsInFirst) bad(`${tag}: drums in the intro section`);
    if (leads < 20) bad(`${tag}: only ${leads} lead notes`); if (bassN < 30) bad(`${tag}: only ${bassN} bass notes`);
    if (!(fadeLast < fadeFirst)) bad(`${tag}: last section does not fade out (${fadeFirst.toFixed(2)} -> ${fadeLast.toFixed(2)})`);
    titles.add(song.title); sigs.add(sig.join('|'));
  }
  if (sigs.size < SEEDS * .9) bad(`${st.id}: only ${sigs.size} different songs from ${SEEDS} seeds`);
  if (titles.size < SEEDS * .5) bad(`${st.id}: only ${titles.size} different titles from ${SEEDS} seeds`);
}

/* ---------- part 2: offline render in headless Chrome ---------- */
let rendered = '';
if (has('--render') || has('--detail') || has('--wav') || has('--engine')) {
  const chrome = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  if (!chrome || typeof WebSocket === 'undefined') rendered = 'render: skipped (no Chrome / WebSocket)';
  else {
    const { serve } = await import('./serve.mjs'), srv = await serve(0), port = 9300 + (process.pid % 500), prof = mkdtempSync(path.join(tmpdir(), 'radio-'));
    const ch = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
    const done = () => { try { ch.kill(); } catch { } srv.close(); };
    try {
      let ws = null; for (let i = 0; i < 60 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = l.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { } if (!ws) await new Promise(r => setTimeout(r, 250)); }
      if (!ws) throw new Error('Chrome did not start');
      const sock = new WebSocket(ws); await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
      let id = 0; const wait = new Map(); sock.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
      const call = (method, params) => new Promise(r => { const i = ++id; wait.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
      const ev = async expr => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error((r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails)).slice(0, 600)); return r.result.result.value; };
      await call('Page.navigate', { url: `http://localhost:${srv.address().port}/tools/radio-render.html` });
      for (let i = 0; i < 80 && !(await ev('window.ready === true')); i++) await new Promise(r => setTimeout(r, 150));
      if (has('--engine')) for (const [bike, rpm, load] of [['raider150', 1400, 0], ['raider150', 5000, .5], ['raider150', 8500, 1], ['click125', 6000, .8], ['cbr650r', 7000, .6]]) console.log(`  engine ${bike.padEnd(9)} ${String(rpm).padStart(5)} rpm load ${load}:`, JSON.stringify(await ev(`renderEngine('${bike}', ${rpm}, ${load}, 4)`)));
      const rows = [], SECS = has('--wav') ? 30 : 24;
      for (let si = 0; si < STATIONS.length; si++) {
        const r = await ev(`renderStation(${si}, 4242, ${SECS}, null, ${has('--wav')})`), id_ = STATIONS[si].id;
        if (r.pcm) { const dir = opt('--wav', '.'); mkdirSync(dir, { recursive: true }); const pcm = Buffer.alloc(r.pcm.length * 2); r.pcm.forEach((x, i) => pcm.writeInt16LE(x, i * 2)); const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40); writeFileSync(path.join(dir, `radio-${id_}.wav`), Buffer.concat([h, pcm])); delete r.pcm; }
        rows.push([id_, r]);
        if (r.nan) bad(`render ${id_}: ${r.nan} NaN samples`); if (r.peak > -1) bad(`render ${id_}: peak ${r.peak} dBFS (clipping risk)`); if (r.minWin < -45) bad(`render ${id_}: a silent second (${r.minWin} dB)`);
        if (Math.abs(r.dc) > .01) bad(`render ${id_}: DC offset ${r.dc}`);
        if (has('--detail')) for (const ins of ['kick', 'snare', 'clap', 'brush', 'hat', 'ohat', 'bass', 'pad', 'rhodes', 'skank', 'organ', 'arp', 'lead']) { const q = await ev(`renderStation(${si}, 4242, 16, ['${ins}'])`); if (q.rms > -100) console.log(`  ${id_.padEnd(6)} ${ins.padEnd(6)} rms ${String(q.rms).padStart(6)}  peak ${String(q.peak).padStart(6)}`); }
      }
      const rm = rows.map(([, r]) => r.rms), spread = Math.max(...rm) - Math.min(...rm); if (spread > 2) bad(`render: stations differ by ${spread.toFixed(1)} dB in loudness (want <= 2): adjust TRIM in js/radiosynth.js`);
      rendered = 'render: ' + rows.map(([n, r]) => `${n} rms ${r.rms} peak ${r.peak} (${r.low}/${r.mid}/${r.high}% lo/mid/hi)`).join(' · ');
    } catch (e) { bad('render failed: ' + e.message); } finally { done(); }
  }
}

if (rendered) console.log(rendered.replace(/ · /g, '\n  ')); // levels are printed even when a check fails, they are what TRIM is tuned from
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); console.log(`radio: ${fails.length} problem(s)`); process.exit(1); }
console.log(`radio: ok (${songs} songs, ${events} note events, ${STATIONS.length} stations)` + '');
process.exit(0);
