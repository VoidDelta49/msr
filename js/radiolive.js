// In-game radio, the live side: which REAL Philippine stations the radio may tune to, and how they are found. No WebAudio and no DOM
// in here, so tools/radio.mjs can test it in Node; js/radio.js plays the result.
//
// The rules the game keeps (see THIRD_PARTY.md, "Live radio"):
//  - Only public service broadcasters: the state network (Philippine Broadcasting Service: Radyo Pilipinas, Republika FM1, Capital
//    FM2) and state university stations. No commercial station is ever listed, whatever the directory holds.
//  - Only the station's own public webcast, played straight from the station's server by the player's browser, exactly as any
//    internet radio does. The game never records, stores, re-hosts, relays, edits or mixes the programme, and puts nothing over it.
//  - No stream address is kept in the repository: they are looked up when the player turns the radio on, in the Radio Browser
//    community directory (radio-browser.info, a free public index), so a station that moves or closes its webcast simply drops out.
//  - The station is named on screen while it plays.

// Radio Browser mirrors, tried in order. The API is free and needs no key.
export const API = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info'];
// every Philippine listing, plus name searches for the public stations (a listing with a missing country code is still found)
const SQ = '/json/stations/search?hidebroken=true&order=votes&reverse=true&limit=';
export const QUERIES = [SQ + '1000&countrycode=PH', ...['radyo pilipinas', 'radyo publiko', 'dzrb', 'republika fm', 'capital fm', 'dzup', 'dzlb'].map(n => SQ + '50&name=' + encodeURIComponent(n))];
export const QUERY = QUERIES[0];
export const clickUrl = (host, id) => host + '/json/url/' + encodeURIComponent(id); // the directory asks players to count a tune-in
export const MAXLIVE = 12;

// the radio log (Options > Audio > Radio log): what the directory answered and what each stream did, readable on a phone with no
// console. RLOG.on = a listener the Options panel sets to redraw, RLOG.rescan = js/radio.js's "search again".
export const RLOG = [];
export function rlog(m) {
  const d = new Date(), t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
  RLOG.push(t + ' ' + m); if (RLOG.length > 120) RLOG.splice(0, RLOG.length - 120);
  try { if (RLOG.on) RLOG.on(); } catch (e) { }
}

// The public broadcasters, by the name (n) or website (h) a directory entry carries. First rule that matches wins; `max` entries per rule.
export const PUBLIC = [
  { id: 'rp1', tag: 'PBS · news & public affairs', n: /\b(rp ?1|dzrb|radyo ng bayan)\b|radyo publiko|radyo pilipinas (1|uno|one)\b/ },
  { id: 'rp2', tag: 'PBS · sports', n: /\b(rp ?2|dzsr)\b|radyo pilipinas (2|dos|two)\b/ },
  { id: 'rp3', tag: 'PBS · public service', n: /\b(rp ?3|dzrm)\b|radyo magasin|radyo pilipinas (3|tres|three)\b/ },
  { id: 'fm1', tag: 'PBS · hit music', n: /republika fm|\bfm ?1\b.*87\.5|87\.5.*\bfm ?1\b/ },
  { id: 'fm2', tag: 'PBS · classic hits', n: /capital fm ?2|\bfm ?2\b.*104\.3|104\.3.*\bfm ?2\b/ },
  { id: 'rpw', tag: 'PBS · world service', n: /\bdzrp\b|radyo pilipinas world/ },
  { id: 'rp', tag: 'PBS · regional', n: /radyo pilipinas/, h: /(^|\.)(pbs\.gov\.ph|radyopilipinas\.ph)$/, max: 2 },
  { id: 'dzup', tag: 'UP Diliman · campus radio', n: /\bdzup\b/, h: /(^|\.)dzup\.org$/ },
  { id: 'dzlb', tag: 'UP Los Baños · campus radio', n: /\bdzlb\b/ },
];
const NOPLAY = /\.(m3u|pls|asx|xspf)(\?|$)/i, HLSU = /\.m3u8(\?|$)/i; // playlists the <audio> element can't open; HLS (.m3u8) only where the browser plays it itself (env.hls). Codec is not checked (the directory often says UNKNOWN)
const IPH = /^(\d{1,3}\.){3}\d{1,3}$|^\[/; // a bare IP address: no https certificate is ever issued for one, so it only works over http
const host = u => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };
// the most-voted Philippine listings by name, for the log (shows how the directory really names the stations)
export const topPH = (rows, n = 25) => Array.isArray(rows) ? [...new Map(rows.filter(r => r && String(r.countrycode || '').toUpperCase() === 'PH').map(r => [r.stationuuid, r])).values()].sort((a, b) => (+b.votes || 0) - (+a.votes || 0)).slice(0, n).map(r => clean(r.name).slice(0, 32)) : [];
export const PHcount = rows => Array.isArray(rows) ? new Set(rows.filter(r => r && String(r.countrycode || '').toUpperCase() === 'PH').map(r => r.stationuuid)).size : 0;
const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>&"'`\\]/g, ' ').replace(/\s+/g, ' ').trim();
export const ruleOf = row => { const n = clean(row.name).toLowerCase(), h = host(row.homepage); return PUBLIC.find(r => r.n.test(n) || (r.h && h && r.h.test(h))) || null; };

// directory rows -> the stations the radio offers: [{ id, name, tag, url, home }], in PUBLIC order. Anything odd is dropped, never repaired.
// why (optional array): a line for every listing a PUBLIC rule matches that was still left out, and why
// env: where it will play. page 'https:' (the published game) can only open https streams on a real host name: browsers block
// http audio on an https page (mixed content) and the bare-IP servers many stations use have no certificate. hls: the browser
// plays HLS in <audio> by itself (Safari, Chrome on Android). The default is the strict case, the published game without HLS.
export function pickLive(rows, why, env = { page: 'https:', hls: false }) {
  const sec = env.page === 'https:';
  if (!Array.isArray(rows)) return [];
  const no = (row, m) => { if (why && why.length < 40 && row && ruleOf(row)) why.push(clean(row.name).slice(0, 40) + ': ' + m); };
  const by = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const cc = String(row.countrycode || '').toUpperCase();
    if (cc !== 'PH' && cc !== '') { no(row, 'country ' + cc); continue; }
    if (+row.lastcheckok !== 1) { no(row, 'directory says the stream is down'); continue; }
    if (/FLAC/i.test(String(row.codec || '')) || (!env.hls && (+row.hls === 1 || /HLS/i.test(String(row.codec || ''))))) { no(row, 'format ' + (row.codec || 'HLS') + ' does not play in this browser'); continue; }
    // https first; an http-only stream is kept too (js/radio.js asks for it over https on an https page, as the browser would anyway)
    const ok = u => typeof u === 'string' && /^https?:\/\/[^\s/]+\.[^\s/]+/.test(u) && u.length < 400 && host(u) && !NOPLAY.test(u) && (env.hls || !HLSU.test(u)) && (!sec || (u.startsWith('https:') && !IPH.test(host(u))));
    const url = [row.url_resolved, row.url].filter(ok).sort((a, b) => (b.startsWith('https:') ? 1 : 0) - (a.startsWith('https:') ? 1 : 0))[0];
    if (url && url.startsWith('https:') && +row.ssl_error === 1) { no(row, 'broken https certificate'); continue; }
    const id = clean(row.stationuuid), name = clean(row.name).slice(0, 30).trim(), rule = ruleOf(row);
    if (!rule) continue;
    if (!url) {
      const u = clean(row.url_resolved || row.url).slice(0, 60), hs = host(row.url_resolved || row.url);
      no(row, (sec && /^http:/.test(u) ? 'http-only stream, browsers block http audio on an https page' : sec && IPH.test(hs) ? 'https on a bare IP address (no certificate)' : HLSU.test(u) ? 'HLS stream, this browser does not play it' : 'no playable address') + ' (' + u + ')'); continue;
    }
    if (!/^[\w-]{8,64}$/.test(id) || name.length < 2) { no(row, 'bad listing'); continue; }
    const home = typeof row.homepage === 'string' && /^https?:\/\//.test(row.homepage) && host(row.homepage) ? row.homepage.slice(0, 200) : '';
    if (!by.has(rule.id)) by.set(rule.id, []);
    if (by.get(rule.id).some(s => s.id === id)) continue; // the same listing from two searches
    by.get(rule.id).push({ id, name, tag: rule.tag, url, home, votes: +row.votes || 0 });
  }
  const out = [], seen = new Set();
  for (const r of PUBLIC) for (const s of (by.get(r.id) || []).sort((a, b) => (b.url.startsWith('https:') - a.url.startsWith('https:')) || b.votes - a.votes || (a.id < b.id ? -1 : 1)).slice(0, r.max || 1)) {
    if (seen.has(s.url) || out.length >= MAXLIVE) continue; seen.add(s.url); delete s.votes; out.push(s);
  }
  if (why) for (const r of PUBLIC) { const n = (by.get(r.id) || []).length - (r.max || 1); if (n > 0) why.push(`${r.tag}: ${n} more listing(s), only the best ${r.max || 1} kept`); }
  return out;
}
// a saved list (localStorage) is only trusted if every entry still has the shape pickLive makes
export const validList = l => Array.isArray(l) && l.length <= MAXLIVE && l.every(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.tag === 'string' && /^https?:\/\//.test(s.url || ''));
