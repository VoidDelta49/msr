// In-game radio, the music side: a station's rules (tempo, key, chord loop, drum grid, bass line, lead rhythm) + a seed make one
// original song, as plain note events. No WebAudio and no DOM in here, so tools/radio.mjs can test it in Node; js/radio.js plays
// the events. Nothing is recorded, sampled or copied from an existing tune: every song is composed from the seed at tune-in time,
// and the next one is a new seed. Station names are invented (no real station is meant).
//
// step = one 16th note (spb steps per bar: 16 for 4/4, 12 for the 3/4 station). stepEvents(song, step) is a pure function of
// (song, step): the same song always plays the same notes.

export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10] };
export const CHORDS = { M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], D7: [0, 4, 7, 10], sus: [0, 5, 7] };
const NOTE_BASS = { r: 0, f: 7, o: 12, t: 4, s: 10 }; // bass step kinds: root, fifth, octave, third, flat seventh (semitones above the chord root)

// one station = one sound and one songwriting recipe
//  prog: chord loops [[rootSemitones, quality] x4]; plan: layers per section (c chords / pad, b bass, g guitar-or-organ stabs, d drums, a arp, l lead)
//  bass: patterns [[step, kind, len]]; drums: grids per drum (velocity per step); lead: rhythm recipe + range; words: title vocabulary
export const STATIONS = [
  {
    id: 'isla', name: 'Isla FM', band: 'FM', freq: '93.3', tag: 'Island pop', spb: 16, bpm: [98, 110], keys: [0, 2, 5, 7, 9], mode: 'major', pent: [0, 2, 4, 7, 9], swing: 0, secBars: 8,
    prog: [[[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']], [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']], [[9, 'm'], [5, 'M'], [0, 'M'], [7, 'M']], [[0, 'M'], [5, 'M'], [9, 'm'], [7, 'sus']]],
    plan: ['cb', 'cbgd', 'cbgdl', 'cbgdl', 'cbgd', 'cbgdl', 'cbgdl', 'cbg'],
    bass: [[[0, 'r', 3], [3, 'r', 1], [6, 'f', 2], [8, 'r', 3], [11, 'o', 1], [14, 'f', 2]], [[0, 'r', 4], [6, 'r', 2], [8, 'r', 4], [12, 'f', 2], [14, 't', 2]]],
    drums: { kick: [1, 0, 0, 0, 0, 0, 0, .5, 1, 0, .6, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, .3], hat: [.4, 0, .75, 0, .4, 0, .75, 0, .4, 0, .75, 0, .4, 0, .75, .3] },
    lead: { lens: [[2, 3], [3, 2], [4, 2], [6, 1], [8, 1]], rest: .12, start: .85, lo: 67, hi: 88 },
    words: [['Salubong', 'Hangin', 'Dalampasigan', 'Tag-araw', 'Alon', 'Sinag', 'Ulap', 'Palma', 'Pawikan', 'Kubo', 'Buhangin', 'Tampisaw', 'Kulay'], ['ng Umaga', 'sa Dagat', 'ng Tag-init', 'sa Baybayin', 'at Araw', 'sa Isla', 'ng Hapon', 'sa Ilog', 'ng Pasko']],
  },
  {
    id: 'takbo', name: 'Takbo FM', band: 'FM', freq: '107.1', tag: 'Night drive', spb: 16, bpm: [106, 122], keys: [9, 2, 4, 7, 11], mode: 'minor', pent: [0, 3, 5, 7, 10], swing: 0, secBars: 8,
    prog: [[[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], [[0, 'm'], [10, 'M'], [8, 'M'], [10, 'M']], [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']], [[8, 'M'], [10, 'M'], [0, 'm'], [0, 'm']]],
    plan: ['c', 'cb', 'cbd', 'cbad', 'cbadl', 'cba', 'cbadl', 'cb'],
    bass: [[[0, 'r', 2], [2, 'r', 2], [4, 'r', 2], [6, 'o', 2], [8, 'r', 2], [10, 'r', 2], [12, 'r', 2], [14, 'o', 2]], [[0, 'r', 2], [2, 'r', 1], [3, 'r', 1], [4, 'r', 2], [6, 'r', 2], [8, 'r', 2], [10, 'r', 1], [11, 'r', 1], [12, 'r', 2], [14, 'o', 2]]],
    drums: { kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [.3, 0, .6, 0, .3, 0, .6, 0, .3, 0, .6, 0, .3, 0, .6, 0], ohat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0] },
    lead: { lens: [[2, 3], [3, 1], [4, 3], [6, 1], [8, 2]], rest: .1, start: .9, lo: 64, hi: 86 },
    words: [['Neon', 'Midnight', 'Tailwind', 'Apex', 'Redline', 'Overdrive', 'Skyline', 'Afterglow', 'Throttle', 'Lowbeam', 'Chrome', 'Hyperlane', 'Turbo'], ['Run', 'Drive', 'Hours', 'Lights', 'Highway', 'Horizon', 'Drift', 'Rush', 'City', 'Heat']],
  },
  {
    id: 'lofi', name: 'Lo-Fi Lot', band: 'FM', freq: '88.5', tag: 'Chill beats', spb: 16, bpm: [72, 84], keys: [0, 3, 5, 7, 10], mode: 'major', pent: [0, 2, 4, 7, 9], swing: .22, secBars: 8,
    prog: [[[2, 'm7'], [7, 'D7'], [0, 'M7'], [9, 'm7']], [[0, 'M7'], [9, 'm7'], [2, 'm7'], [7, 'D7']], [[4, 'm7'], [9, 'm7'], [2, 'm7'], [7, 'D7']], [[0, 'M7'], [5, 'M7'], [4, 'm7'], [9, 'm7']]],
    plan: ['cb', 'cbd', 'cbdl', 'cbdl', 'cbd', 'cb'],
    bass: [[[0, 'r', 5], [6, 'r', 2], [10, 'f', 4]], [[0, 'r', 6], [8, 'f', 2], [10, 'r', 4]]],
    drums: { kick: [1, 0, 0, 0, 0, 0, 0, .7, 0, 0, .8, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, .25], hat: [.4, .15, .3, .15, .4, .15, .3, .2, .4, .15, .3, .15, .4, .15, .3, .2] },
    lead: { lens: [[3, 2], [4, 3], [6, 2], [8, 2]], rest: .3, start: .7, lo: 60, hi: 81 },
    words: [['Rain on', 'Slow', 'Cold', 'Late', 'Sleepy', 'Quiet', 'Paper', 'Warm', 'Soft', 'Faded'], ['Tin Roof', 'Coffee', 'Window', 'Static', 'Sundays', 'Rooftops', 'Tea', 'Lanterns', 'Streets', 'Mornings']],
  },
  {
    id: 'am', name: 'Radyo Barangay', band: 'AM', freq: '810', tag: 'Old-time ballads', spb: 12, bpm: [84, 96], keys: [0, 5, 7, 2, 10], mode: 'major', pent: [0, 2, 4, 7, 9], swing: 0, secBars: 8,
    prog: [[[0, 'M'], [9, 'm'], [2, 'm'], [7, 'D7']], [[0, 'M'], [5, 'M'], [0, 'M'], [7, 'D7']], [[0, 'M'], [4, 'm'], [5, 'M'], [7, 'D7']], [[9, 'm'], [2, 'm'], [7, 'D7'], [0, 'M']]],
    plan: ['cb', 'cbg', 'cbgl', 'cbgdl', 'cbgdl', 'cbgl', 'cbgd', 'cb'],
    bass: [[[0, 'r', 4], [4, 'f', 4], [8, 'f', 4]], [[0, 'r', 4], [4, 'r', 2], [6, 'f', 2], [8, 'f', 4]]],
    drums: { kick: [.6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, .5, 0, 0, 0, .5, 0, 0, 0], hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    lead: { lens: [[4, 4], [6, 2], [8, 2], [12, 1], [2, 1]], rest: .08, start: .95, lo: 62, hi: 81 },
    words: [['Awit ng', 'Huling', 'Sa Ilalim ng', 'Pangako sa', 'Habang', 'Alaala ng', 'Gabi ng', 'Hele ng'], ['Buwan', 'Pag-ibig', 'Tag-ulan', 'Bituin', 'Paalam', 'Tahanan', 'Kabilang Ibayo', 'Nayon', 'Pag-asa']],
  },
];

/* ---------- seeded randomness ---------- */
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
// position-based noise: the same (seed, step, k) always gives the same number, so stepEvents stays a pure function
const hf = (a, b, c) => { let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const pick = (r, a) => a[r() * a.length | 0];
const wpick = (r, w) => { let t = 0; for (const [, k] of w) t += k; let x = r() * t; for (const [v, k] of w) { x -= k; if (x <= 0) return v; } return w[0][0]; };

/* ---------- composing ---------- */
// chord tones as MIDI notes, each placed in the octave nearest `centre` (close voicing, drifting with the previous chord)
function voice(rootPc, ivs, lo, hi, centre) {
  const out = ivs.map(iv => { const pc = (rootPc + iv) % 12; let m = pc + 12 * Math.round((centre - pc) / 12); while (m < lo) m += 12; while (m > hi) m -= 12; return m; });
  return out.sort((a, b) => a - b);
}
function rhythm(r, spb, o) { // [[step, len]] filling one bar, with rests
  for (let tries = 0; tries < 8; tries++) {
    const out = []; let pos = 0, lastRest = false;
    if (r() > o.start) { pos = spb === 12 ? 4 : 2; lastRest = true; }
    while (pos < spb) {
      const len = Math.min(spb - pos, wpick(r, o.lens));
      if (!lastRest && r() < o.rest) lastRest = true; else { out.push([pos, len]); lastRest = false; }
      pos += len;
    }
    if (out.length >= 2) return out;
  }
  return [[0, spb >> 1], [spb >> 1, spb >> 1]];
}
// one 4-bar melodic phrase over the chord loop: chord tones on strong beats, stepwise motion between, a settled last note
function phrase(r, st, key, scale, chords) {
  const pool = []; for (let m = st.lead.lo; m <= st.lead.hi; m++) if (scale.includes(((m - key) % 12 + 12) % 12)) pool.push(m);
  const ctr = pool.length * .45 | 0; let ix = ctr + (r() * 3 | 0) - 1; const spb = st.spb, rh = [rhythm(r, spb, st.lead), rhythm(r, spb, st.lead)]; rh.push(rh[0], rhythm(r, spb, st.lead));
  const isTone = (m, c) => c.ivs.some(iv => (m - c.pc - iv) % 12 === 0);
  const snap = (c, w, tgt = ix) => { let best = ix, bd = 99; for (let k = Math.max(0, ix - w); k <= Math.min(pool.length - 1, ix + w); k++) if (isTone(pool[k], c)) { const d = Math.abs(k - tgt); if (d < bd) { bd = d; best = k; } } return best; };
  const bars = [];
  for (let b = 0; b < 4; b++) {
    const c = chords[b], notes = []; let rb = rh[b].map(x => x.slice());
    if (b === 3) { rb = rb.filter(x => x[0] < spb - 6); const e = rb.length ? rb[rb.length - 1][0] + rb[rb.length - 1][1] : 0, s0 = Math.min(Math.max(e, spb >> 1), spb - 4); rb = rb.filter(x => x[0] + x[1] <= s0); rb.push([s0, spb - s0]); } // the last note of the phrase rings to the bar line
    rb.forEach(([s, len], j) => {
      const prev = ix;
      if (j === 0) ix = snap(c, 5);
      else {
        let mv = pick(r, [-2, -1, -1, 0, 1, 1, 2, r() < .12 ? 3 : 1]); if (ix > ctr + 6) mv -= 1; else if (ix < ctr - 6) mv += 1;
        ix = Math.max(0, Math.min(pool.length - 1, ix + mv)); if (ix === prev && r() < .55) ix = Math.max(0, Math.min(pool.length - 1, ix + (r() < .5 ? -1 : 1)));
        if (s % 4 === 0 && len >= 3) ix = snap(c, 2);
      }
      if (b === 3 && j === rb.length - 1) ix = snap({ pc: c.pc, ivs: [0, 7] }, 5, ctr); // settle on the chord's root or fifth, back near the middle of the range so the next phrase starts close by
      notes.push({ s, len, m: pool[ix], v: s % 4 === 0 ? .85 : .65 });
    });
    bars.push(notes);
  }
  return bars;
}
function title(r, st) { return pick(r, st.words[0]) + ' ' + pick(r, st.words[1]); }

export function makeSong(si, seed) {
  const st = STATIONS[si], r = mulberry(seed >>> 0), spb = st.spb;
  const keyPc = pick(r, st.keys), scale = SCALES[st.mode], bpm = Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0])), loop = pick(r, st.prog);
  let centre = 62; const chords = loop.map(([off, q]) => {
    const pc = (keyPc + off) % 12, ivs = CHORDS[q], notes = voice(pc, ivs, 52, 74, centre); centre = Math.max(58, Math.min(66, notes.reduce((a, b) => a + b, 0) / notes.length));
    const bass = pc + 12 * Math.round((44 - pc) / 12), arp = [...notes, ...notes.map(n => n + 12)].filter(n => n <= 86);
    return { pc, q, ivs, notes, bass, arp };
  });
  const A = phrase(r, st, keyPc, scale, chords), B = phrase(r, st, keyPc, scale, chords);
  const seqs = [[A, A], [A, B], [A, A], [B, A]], secs = st.plan.length;
  return {
    si, seed: seed >>> 0, title: title(r, st), bpm, key: keyPc, spb, swing: st.swing, secBars: st.secBars, plan: st.plan, chords, loop: loop.length,
    bassPat: pick(r, st.bass), arpPat: pick(r, [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 4, 5, 4, 2, 1, 3], [0, 3, 1, 4, 2, 5, 3, 1]]),
    lead: Array.from({ length: secs }, (_, s) => { const [p, q] = seqs[s % 4]; return [...p, ...q]; }), // section -> 8 bars of notes
    total: secs * st.secBars * spb, stepDur: 60 / bpm / 4,
  };
}

/* ---------- note events for one step ---------- */
// event = { i: instrument, m: midi (one note) | n: [midi] (a chord), v: 0-1, d: length in steps }. A drum has no pitch.
export function stepEvents(song, step) {
  const out = [], st = STATIONS[song.si], spb = song.spb; if (step < 0 || step >= song.total) return out;
  const bar = step / spb | 0, s = step % spb, sec = bar / song.secBars | 0, lay = song.plan[sec], c = song.chords[bar % song.loop], bb = bar % song.secBars, hv = k => hf(song.seed, step, k);
  const has = ch => lay.includes(ch), last = sec === song.plan.length - 1, fade = last ? 1 - bb / song.secBars * .9 : 1; // the last section fades out
  const ev = (i, v, d, x) => out.push({ i, v: Math.max(0, Math.min(1, v * fade)), d, ...x });
  // chords: pad on the bar line; the lo-fi station strums a rhodes and re-hits it; the waltz keeps the pad soft under the organ
  if (has('c')) {
    if (st.id === 'lofi') { if (s === 0) ev('rhodes', .8, spb, { n: c.notes }); else if (s === 10 && hv(1) < .6) ev('rhodes', .5, 4, { n: c.notes }); }
    else if (s === 0) ev('pad', st.id === 'am' ? .55 : .7, spb, { n: c.notes });
  }
  if (has('b')) for (const [bs, kind, len] of song.bassPat) if (bs === s && (spb === 12 || hv(2) < .93)) ev('bass', .9, len, { m: c.bass + NOTE_BASS[kind] > 55 ? c.bass + NOTE_BASS[kind] - 12 : c.bass + NOTE_BASS[kind] });
  if (has('g')) {
    if (st.id === 'isla' && s % 4 === 2) ev('skank', s === 6 || s === 14 ? .6 : .45, 1, { n: c.notes.map(n => n + 12).slice(0, 3) }); // off-beat guitar chops
    if (st.id === 'am' && (s === 4 || s === 8)) ev('organ', .5, 3, { n: c.notes });                                                         // oom-pah-pah
  }
  if (has('a')) ev('arp', [1, .45, .7, .45][s % 4] * .8, 1, { m: c.arp[song.arpPat[s % song.arpPat.length] % c.arp.length] });
  if (has('l')) { const n = song.lead[sec][bb]?.find(x => x.s === s); if (n) ev('lead', n.v, n.len, { m: n.m }); }
  if (has('d')) {
    const D = st.drums, fill = bb === song.secBars - 1 && !last;
    if (D.kick?.[s]) ev('kick', D.kick[s] * (.9 + .1 * hv(3)), 1);
    if (D.snare?.[s]) ev(st.id === 'am' ? 'brush' : st.id === 'takbo' ? 'clap' : 'snare', D.snare[s] * (.9 + .1 * hv(4)), 1);
    if (D.hat?.[s] && (st.id !== 'lofi' || hv(5) < .85)) ev('hat', D.hat[s] * (.85 + .3 * hv(6)), 1);
    if (D.ohat?.[s]) ev('ohat', .6, 1);
    if (fill && s >= spb - 4) ev(st.id === 'takbo' ? 'clap' : 'snare', .35 + .15 * (s - (spb - 4)), 1);
  }
  return out;
}
export const songSeconds = song => song.total * song.stepDur;
export const stationLabel = i => { const s = STATIONS[i]; return s.name + ' ' + s.freq + (s.band === 'AM' ? ' AM' : ''); };
