// Friends (multiplayer). Tap a friend's name tag while either of you is on foot for the social panel (#soc):
//   👋 WAVE     they see it (a message and the emoji on your tag)
//   🍶 TREAT    buy them a drink from data/shop.json 'treat' (you pay, it lands in their bag: they tap DRINK). Close by or in the same room
//   🥂 CHEERS   raise a glass (you drink what you carry); they get a CHEERS button to clink back and drink theirs. "Tagay!"
//   📍 CALL     "punta ka dito": your spot (or the door of the building you're in) becomes their waypoint, whatever the distance
// The friend list in MULTIPLAYER (menu.js) shows where everyone is (riding, on foot, in which building) with FIND (a waypoint to them)
// and CALL. Friends in the same building see each other inside (interior.js pockets), and a drunk friend's walker sways (net.js).
// Relay message (server/worker.js cleanSoc): { t: 'soc', op: wave | treat | cheers | clink | call | thanks, to, item?, x?, z?, place? }.
import { S, ctx } from './state.js';
import { NET, send } from './net.js';
import { F } from './foot.js';
import { say } from './hud.js';
import { blip } from './audio.js';
import { $ } from './util.js';
import { setWaypoint } from './map.js';
import { SHOPD } from './places.js';
import { item, gift, pay, peso, next, SHOP } from './shop.js';

const pnl = $('soc'), txt = $('socT'), btns = $('socB');
let who = 0, uiT = 0;
const name = id => (NET.peers.get(id) || { name: 'Rider' }).name;
const close = () => { pnl.hidden = true; who = 0; };
$('socX').onclick = close;
function panel(t, list, id) {
  txt.textContent = t; who = id || 0; pnl.hidden = false; clearTimeout(uiT); uiT = setTimeout(close, 15000);
  btns.replaceChildren(...list.map(([l, fn, hot]) => { const b = document.createElement('button'); b.className = 'b' + (hot ? ' hot' : ''); b.textContent = l; b.onclick = fn; return b; }));
}
const emote = (P, e) => { if (P) { P.emo = e; P.emoT = performance.now() + 4000; } };
const sameRoom = P => (ctx.inside ? ctx.inside.key : '') === (P.pk || '');
const close2 = P => P.d < 10 && sameRoom(P);
// where we are, for CALL: the door step of the building we're in, else the walker / the bike
function here() {
  const P = ctx.inside; if (P) return { x: P.door.x, z: P.door.z, place: P.def.name };
  return F.on ? { x: F.x, z: F.z, place: '' } : { x: S.x, z: S.z, place: '' };
}

export function socialPanel(P) {
  const L = [['👋 WAVE', () => { send({ t: 'soc', op: 'wave', to: P.id }); emote(P, ''); F.anim = 'wave'; F.animT = 1.6; say('You wave at ' + P.name, 1200); close(); }, true]];
  L.push(['🍶 TREAT', () => treatPanel(P)]);
  L.push(['🥂 CHEERS', () => cheers(P)]);
  L.push(['📍 CALL', () => call(P)]);
  panel(P.name + (P.pk ? ' · ' + (ctx.placeName(P.pk) || 'inside') : '') + ' · ' + Math.round(P.d) + ' m', L, P.id);
}
function treatPanel(P) {
  if (!close2(P)) return say(`Get closer to ${P.name} to treat them (or be in the same place)`, 2000);
  panel(`Treat ${P.name} to… (you have ${peso(SHOP.money)})`, (SHOPD.treat || []).map(id => { const I = item(id); return I && [`${I.icon} ${peso(I.price)}`, () => {
    const why = pay(I.price); if (why) return say(why, 1800);
    send({ t: 'soc', op: 'treat', to: P.id, item: id }); say(`You treated ${P.name} to a ${I.name} ${I.icon}`, 2000); blip('ok'); close();
  }]; }).filter(Boolean), P.id);
}
function cheers(P) {
  if (!F.on) return say('Get off the bike first', 1400);
  if (P.d > 8 || !sameRoom(P)) return say(`Get closer to ${P.name}`, 1400);
  send({ t: 'soc', op: 'cheers', to: P.id }); toast(); say(`🥂 Tagay, ${P.name}!`, 1600); close();
}
function toast() { const id = next(); if (id && ctx.consume) { ctx.consume(id); } else { F.anim = 'cheers'; F.animT = 1.2; } } // you drink what you carry, else just raise your hand
function call(P) {
  const h = here(); send({ t: 'soc', op: 'call', to: P.id, x: Math.round(h.x * 10) / 10, z: Math.round(h.z * 10) / 10, place: h.place.slice(0, 32) });
  say(`📍 You called ${P.name} over` + (h.place ? ' to ' + h.place : ''), 1800); close();
}
function find(P) { setWaypoint(P.x, P.z, 'Friend: ' + P.name); say(`📌 Waypoint on ${P.name}`, 1500); }
ctx.social = { call, find };

/* ---------- incoming ---------- */
NET.on.soc = m => {
  const P = NET.peers.get(m.from), n = name(m.from); if (!P) return;
  switch (m.op) {
    case 'wave': emote(P, '👋'); say(`👋 ${n} waves at you`, 2000); blip('click'); break;
    case 'treat': { const I = item(m.item); if (!I || !(SHOPD.treat || []).includes(m.item)) return; gift(m.item); emote(P, I.icon); say(`${I.icon} ${n} treated you to a ${I.name}! Tap ${I.use || 'DRINK'} when you're ready`, 3200); blip('ok'); send({ t: 'soc', op: 'thanks', to: m.from }); break; }
    case 'thanks': emote(P, '🙏'); say(`🙏 ${n}: "Salamat, pare!"`, 1600); break;
    case 'cheers': emote(P, '🥂'); if (F.on && !ctx.GAR) panel(`🥂 ${n} raises a glass`, [['🥂 CHEERS', () => { send({ t: 'soc', op: 'clink', to: m.from }); toast(); say('Tagay!', 1200); close(); }, true]], m.from); else say(`🥂 ${n} raises a glass`, 1600); break;
    case 'clink': emote(P, '🥂'); say(`🥂 ${n}: "Tagay!"`, 1600); blip('ball', 4); break;
    case 'call': emote(P, '📍'); setWaypoint(m.x, m.z, n + (m.place ? ' · ' + m.place : '')); say(`📍 ${n}: "Punta ka dito!"` + (m.place ? ' (' + m.place + ')' : '') + ' · waypoint set', 3200); blip('click'); break;
  }
};
// tap a name tag: the social panel when either of you is on foot (ride.js puts RIDE in front of this when a seat is free; race.js after)
const before = NET.on.tap;
NET.on.tap = P => { if (F.on || (P.fl & 64)) return socialPanel(P); if (before) before(P); };
