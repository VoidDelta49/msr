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
export const QUERY = '/json/stations/search?countrycode=PH&hidebroken=true&is_https=true&order=votes&reverse=true&limit=1000';
export const clickUrl = (host, id) => host + '/json/url/' + encodeURIComponent(id); // the directory asks players to count a tune-in
export const MAXLIVE = 8;

// The public broadcasters, by the name (n) or website (h) a directory entry carries. First rule that matches wins; `max` entries per rule.
export const PUBLIC = [
  { id: 'rp1', tag: 'PBS · news & public affairs', n: /\b(rp ?1|dzrb|radyo ng bayan)\b|radyo pilipinas (1|uno|one)\b/ },
  { id: 'rp2', tag: 'PBS · sports', n: /\b(rp ?2|dzsr)\b|radyo pilipinas (2|dos|two)\b/ },
  { id: 'rp3', tag: 'PBS · public service', n: /\b(rp ?3|dzrm)\b|radyo magasin|radyo pilipinas (3|tres|three)\b/ },
  { id: 'fm1', tag: 'PBS · hit music', n: /republika fm|\bfm ?1\b.*87\.5|87\.5.*\bfm ?1\b/ },
  { id: 'fm2', tag: 'PBS · classic hits', n: /capital fm ?2|\bfm ?2\b.*104\.3|104\.3.*\bfm ?2\b/ },
  { id: 'rpw', tag: 'PBS · world service', n: /\bdzrp\b|radyo pilipinas world/ },
  { id: 'rp', tag: 'PBS · regional', n: /radyo pilipinas/, h: /(^|\.)(pbs\.gov\.ph|radyopilipinas\.ph)$/, max: 2 },
  { id: 'dzup', tag: 'UP Diliman · campus radio', n: /\bdzup\b/, h: /(^|\.)dzup\.org$/ },
  { id: 'dzlb', tag: 'UP Los Baños · campus radio', n: /\bdzlb\b/ },
];
const CODEC = new Set(['MP3', 'AAC', 'AAC+', 'OGG']); // what an <audio> element plays everywhere; HLS playlists are left out (Chrome can't)
const host = u => { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } };
const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>&"'`\\]/g, ' ').replace(/\s+/g, ' ').trim();
export const ruleOf = row => { const n = clean(row.name).toLowerCase(), h = host(row.homepage); return PUBLIC.find(r => r.n.test(n) || (r.h && h && r.h.test(h))) || null; };

// directory rows -> the stations the radio offers: [{ id, name, tag, url, home }], in PUBLIC order. Anything odd is dropped, never repaired.
export function pickLive(rows) {
  if (!Array.isArray(rows)) return [];
  const by = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    if (String(row.countrycode || '').toUpperCase() !== 'PH' || +row.lastcheckok !== 1 || +row.hls === 1 || +row.ssl_error === 1) continue;
    if (!CODEC.has(String(row.codec || '').toUpperCase())) continue;
    const url = [row.url_resolved, row.url].find(u => typeof u === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/.test(u) && u.length < 400 && host(u));
    const id = clean(row.stationuuid), name = clean(row.name).slice(0, 30).trim(), rule = ruleOf(row);
    if (!url || !/^[\w-]{8,64}$/.test(id) || name.length < 2 || !rule) continue;
    const home = typeof row.homepage === 'string' && /^https?:\/\//.test(row.homepage) && host(row.homepage) ? row.homepage.slice(0, 200) : '';
    if (!by.has(rule.id)) by.set(rule.id, []);
    by.get(rule.id).push({ id, name, tag: rule.tag, url, home, votes: +row.votes || 0 });
  }
  const out = [], seen = new Set();
  for (const r of PUBLIC) for (const s of (by.get(r.id) || []).sort((a, b) => b.votes - a.votes || (a.id < b.id ? -1 : 1)).slice(0, r.max || 1)) {
    if (seen.has(s.url) || out.length >= MAXLIVE) continue; seen.add(s.url); delete s.votes; out.push(s);
  }
  return out;
}
// a saved list (localStorage) is only trusted if every entry still has the shape pickLive makes
export const validList = l => Array.isArray(l) && l.length <= MAXLIVE && l.every(s => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.tag === 'string' && /^https:\/\//.test(s.url || ''));
