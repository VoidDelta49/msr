// Multiplayer sprint race: tap a rider's name tag (within 90 m) to challenge them. The one who accepts picks a finish
// on a road about the same distance from both of you (350-900 m), and sends "go" through the relay with echo, so both
// phones start the 3-2-1 countdown at the same moment. Times are each phone's own clock from GO (+3 s for a false
// start); both send their time when they reach the finish and the lower one wins. No teleport, no grid: race from
// where you are. Quests can't start during a race, and a race can't start during a quest.
import { S, ctx } from './state.js';
import { NET, send } from './net.js';
import { MI, beacon, pins } from './missions.js';
import { ROADS, H } from './world.js';
import { say } from './hud.js';
import { blip } from './audio.js';
import { $ } from './util.js';

const R = { st: 'idle' }, FIN_R = 10, finB = beacon(0xffb020, FIN_R);
const pnl = $('race'), txt = $('raceT'), bY = $('raceY'), bX = $('raceX'), cd = $('rcd');
let yes = null, no = null, uiT = 0;
function panel(t, y, n, fy) { txt.textContent = t; pnl.hidden = false; bY.hidden = !y; if (y) bY.textContent = y; yes = y ? fy : null; no = n || null; }
bY.onclick = () => yes && yes(); bX.onclick = () => (no || reset)();
const name = id => (NET.peers.get(id) || { name: 'Rider' }).name;
const busy = () => R.st !== 'idle' || MI.q || ctx.GAR || ctx.OPT || ctx.paused || S.crashed;

function reset() { R.st = 'idle'; R.opp = 0; ctx.racing = false; pnl.hidden = true; cd.classList.remove('on'); finB.visible = false; pins(null); }

// tap on a name tag
NET.on.tap = P => {
  if (R.st !== 'idle') return say(R.st === 'go' || R.st === 'count' ? 'You are already racing' : 'A race request is open');
  if (MI.q) return say('Finish or cancel your job first');
  if (P.d > 90) return say(P.name + ' is too far away. Ride closer (90 m)');
  if (P.fl & 16) return say(P.name + ' is in a race');
  panel('Race ' + P.name + '?', 'RACE', reset, () => ask(P));
};
function ask(P) {
  R.st = 'ask'; R.opp = P.id; R.rid = Math.random() * 1e9 | 0; R.until = performance.now() + 15000;
  send({ t: 'race', op: 'ask', to: P.id, rid: R.rid }); panel('Waiting for ' + P.name + '…', null, () => { send({ t: 'race', op: 'no', to: R.opp, rid: R.rid }); reset(); });
}
function accept() {
  const P = NET.peers.get(R.opp); if (!P) return reset();
  const f = finish(S.x, S.z, P.x, P.z);
  if (!f) { send({ t: 'race', op: 'no', to: R.opp, rid: R.rid, why: 'course' }); say("Couldn't find a course from here. Try nearer the town"); return reset(); }
  R.st = 'acc'; send({ t: 'race', op: 'go', to: R.opp, rid: R.rid, x: f.x, z: f.z, echo: true }); panel('Starting…', null, null);
}
// a road point 350-900 m away whose distance from both riders differs by at most ~5 %
function finish(ax, az, bx, bz) {
  let best = null, bd = 1e9; const ok = [];
  for (const r of ROADS) {
    if (r.kind === 'strip' || !r.s) continue;
    for (let i = 0; i < r.s.length; i += 3) {
      const p = r.s[i], da = Math.hypot(p.x - ax, p.z - az), db = Math.hypot(p.x - bx, p.z - bz), e = Math.abs(da - db);
      if (da < 350 || da > 900) continue; if (e <= Math.max(8, da * .05)) ok.push(p); else if (e < bd) { bd = e; best = p; }
    }
  }
  return ok.length ? ok[Math.random() * ok.length | 0] : best && bd < 40 ? best : null;
}

NET.on.race = m => {
  const now = performance.now();
  if (m.op === 'ask') {
    if (busy()) return send({ t: 'race', op: 'busy', to: m.from, rid: m.rid });
    R.st = 'inv'; R.opp = m.from; R.rid = m.rid; R.until = now + 15000; blip('ok');
    panel(name(m.from) + ' wants to race!', 'ACCEPT', () => { send({ t: 'race', op: 'no', to: R.opp, rid: R.rid }); reset(); }, accept);
    return;
  }
  if (m.rid !== R.rid) return;
  if (m.op === 'no' || m.op === 'busy') {
    if (R.st !== 'ask' && R.st !== 'inv' && R.st !== 'acc') return;
    say(m.op === 'busy' ? name(R.opp) + ' is busy right now' : m.why === 'course' ? 'No course found between you two' : R.st === 'ask' ? name(R.opp) + ' declined' : 'Race cancelled', 2200); reset();
  } else if (m.op === 'go') {
    if (R.st !== 'ask' && R.st !== 'acc') return;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.z)) { send({ t: 'race', op: 'quit', to: R.opp, rid: R.rid }); return reset(); }
    Object.assign(R, { st: 'count', fx: m.x, fz: m.z, tc: now + 3000, pen: 0, myT: null, oppT: null, d0: Math.hypot(m.x - S.x, m.z - S.z) });
    R.limit = 60 + R.d0 / 6; ctx.racing = true; finB.position.set(m.x, H(m.x, m.z), m.z); finB.visible = true;
    pins([{ x: m.x, z: m.z, c: '#ffb020', g: '' }]); panel('Race vs ' + name(R.opp) + ' · hold still', null, quit);
  } else if (m.op === 'fin') {
    R.oppT = Number.isFinite(m.time) && m.time >= 0 ? m.time : Infinity; if (R.st === 'go') say(name(R.opp) + ' finished in ' + R.oppT.toFixed(1) + ' s. Keep going!', 2500); else if (R.st === 'done') result();
  } else if (m.op === 'quit') {
    if (R.st === 'count') { say(name(R.opp) + ' cancelled the race'); reset(); }
    else if (R.st === 'go') end(name(R.opp) + ' gave up. You win!', true);
    else if (R.st === 'done') { R.oppT = Infinity; result(); }
  }
};
NET.on.leave = P => { if (P.id !== R.opp || R.st === 'idle' || R.st === 'res') return; if (R.st === 'go' || R.st === 'done') end(P.name + ' left. You win!', true); else { say(P.name + ' left'); reset(); } };
function quit() { if (R.st !== 'idle') send({ t: 'race', op: 'quit', to: R.opp, rid: R.rid }); if (R.st === 'go') say('You gave up'); reset(); }
function end(msg, win) { R.st = 'res'; ctx.racing = false; finB.visible = false; pins(null); cd.classList.remove('on'); if (win) blip('ok'); panel(msg, null, reset); bX.textContent = 'OK'; }
function result() {
  const a = R.myT, b = R.oppT, f = t => t === Infinity ? 'DNF' : t.toFixed(1) + ' s';
  if (a < b) end('YOU WIN! ' + f(a) + ' vs ' + f(b), true); else end(name(R.opp) + ' wins. ' + f(b) + ' vs ' + f(a), false);
}

// every frame (also while paused, so timeouts and the countdown keep running)
export function raceTick(dt) {
  const now = performance.now(); if (R.st === 'idle') return; if (R.st !== 'res') bX.textContent = '✕';
  if ((R.st === 'ask' || R.st === 'inv') && now > R.until) { if (R.st === 'inv') send({ t: 'race', op: 'no', to: R.opp, rid: R.rid }); say(R.st === 'ask' ? 'No answer' : 'Race request expired'); return reset(); }
  if (R.st === 'acc' && now > R.until + 5000) return reset();
  if (NET.st !== 'on' && R.st !== 'res') { say('Disconnected, race over'); return reset(); }
  if (R.st === 'count' || R.st === 'go' || R.st === 'done') MI.arm = false; // no quests from hubs mid-race
  if (R.st === 'count') {
    const left = Math.ceil((R.tc - now) / 1000), t = left > 0 ? String(left) : 'GO!';
    if (cd.textContent !== t) { cd.textContent = t; cd.classList.add('on'); blip(left > 0 ? 'click' : 'ok'); }
    if (!R.pen && Math.abs(S.v) > 2) { R.pen = 3; say('False start! +3 s', 2000); }
    if (now >= R.tc) { R.st = 'go'; R.t0 = now; setTimeout(() => cd.textContent === 'GO!' && cd.classList.remove('on'), 900); }
    return;
  }
  if (R.st === 'go') {
    const el = (now - R.t0) / 1000, d = Math.hypot(R.fx - S.x, R.fz - S.z);
    if ((uiT += dt) > .1) { uiT = 0; txt.textContent = '🏁 ' + name(R.opp) + ' · ' + Math.round(d) + ' m · ' + el.toFixed(1) + ' s'; }
    if (d < FIN_R) {
      R.myT = el + R.pen; send({ t: 'race', op: 'fin', to: R.opp, rid: R.rid, time: R.myT }); blip('ok');
      if (R.oppT !== null) return result();
      R.st = 'done'; R.doneT = now; finB.visible = false; panel('Finished in ' + R.myT.toFixed(1) + ' s · waiting for ' + name(R.opp) + '…', null, quit);
    } else if (el > R.limit) { send({ t: 'race', op: 'quit', to: R.opp, rid: R.rid }); end('Out of time', false); }
    return;
  }
  if (R.st === 'done' && now - R.doneT > 90000) { R.oppT = Infinity; result(); }
}
