#!/usr/bin/env node
// Buildings, shops, drinking and friends in a real browser (needs playwright, skips itself otherwise; see the header of tools/smoke.mjs).
//   PW=/path/to/playwright node tools/places.mjs [--shot dir] [--webgpu]
// A  the bar: get off next to the billiards & bar, the context button says ENTER at its door, you are in the pocket room (walls, NPC crowd
//    hidden, room shown), ORDER at the counter opens the shop, BUY takes the money, DRINK plays the drink and makes you drunk, the drunk
//    pass is built and drawn, a SHOOT at the pool table moves the cue ball, EXIT puts you on the step outside on the island's ground,
//    GET ON at the bike, and the drunk rider's steering is not the keyboard's.
// B  friends, through a fake relay (WebSocket stub, a fake rider #5 walking next to us, fed with the same binary walker packets net.js sends):
//    tapping their tag on foot opens the social panel, WAVE / CHEERS / CALL send soc messages, TREAT pays and sends the item, incoming
//    treat / call / cheers do what they say (bag, waypoint, CHEERS back), our walker packets carry the drunk byte, and a friend walking in
//    the bar's pocket is drawn only while we are in the same room (outside, their tag says they're inside).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('places: skipped (playwright not found; see header of tools/smoke.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [], shot = opt('--shot');
const GPU = a.includes('--webgpu'); // WebGPU on swiftshader's Vulkan (as tools/smoke.mjs --webgpu); default WebGL 2
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(GPU ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] : [])] }); } catch (e) { console.log('places: skipped (no chromium)'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
if (shot) mkdirSync(shot, { recursive: true });
const snap = async n => { if (shot) await pg.screenshot({ path: path.join(shot, n + '.png') }); };
try {
  await pg.addInitScript(gpu => {
    if (!gpu) sessionStorage.setItem('cpmGL', '1'); localStorage.setItem('cpmme', JSON.stringify({ tod: 13, bike: 'click125', gfx: 'low' })); localStorage.setItem('cpm.wallet', '300'); localStorage.removeItem('cpm.bag');
    window.__sent = []; window.WebSocket = class { constructor(u) { this.url = u; this.readyState = 1; this.bufferedAmount = 0; this.binaryType = 'arraybuffer'; window.__ws = this; } send(d) { window.__sent.push(typeof d === 'string' ? JSON.parse(d) : { bin: new Uint8Array(d)[1], raw: new Uint8Array(d).slice() }); } close() { } };
  }, GPU);
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
  // everything per frame is waited for with until() (swiftshader runs at a few frames per second, and game time is capped at 50 ms a frame:
  // the 1.5 s drink takes ~6 s of real time there)
  const helpers = () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    window.__h = { sleep, until: async (f, ms = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (f()) return true; await sleep(40); } return !!f(); },
      lab: () => { const b = document.getElementById('bFoot'); return b.hidden ? '' : b.textContent; },
      at: (P, x, z) => ({ x: P.ox + x * P.c + z * P.s, z: P.oz - x * P.s + z * P.c }) };
  };
  await pg.evaluate(helpers);
  /* ---------- A: the bar ---------- */
  const A = await pg.evaluate(async () => {
    const c = window.__cpm, ctx = c.ctx, F = c.F, S = c.S, { until, sleep, lab, at } = window.__h, fails = [], ok = (v, m) => { if (!v) fails.push(m); };
    const W = await import('./js/world.js'), E = await import('./js/effects.js'), R = await import('./js/renderer.js'), SH = await import('./js/shop.js'), $ = id => document.getElementById(id);
    const d = W.DOORS.find(q => q.t === 'bar'); ok(d, 'no bar door on the island'); if (!d) return fails;
    c.reset(); S.x = d.x + 3; S.z = d.z + 3; S.psi = 0; S.zH = W.H(S.x, S.z) + .8; c.syncBody(); await sleep(300); if (ctx.camMode === 0) c.toggleCam();
    ok(await until(() => { if (!F.on) c.getOff(); return F.on; }, 20000), 'could not get off'); F.x = d.x; F.z = d.z; F.y = W.H(d.x, d.z); // (until: the teleported bike has to settle first)
    ok(await until(() => lab() === 'ENTER'), `button at the bar door says "${lab()}" (walker ${F.x.toFixed(1)},${F.y.toFixed(2)},${F.z.toFixed(1)} gnd ${F.gnd}, door ${d.x.toFixed(1)},${d.z.toFixed(1)}, bike ${S.x.toFixed(1)},${S.z.toFixed(1)})`); $('bFoot').click();
    ok(await until(() => ctx.inside), 'ENTER did not take us inside'); const P = ctx.inside; if (!P) return fails;
    ok(Math.abs(F.y - P.oy) < .01 && P.oy > 200, `inside at y ${F.y}`); await sleep(300); ok(Math.abs(c.camera.position.y - P.oy) < 6, `camera at y ${c.camera.position.y.toFixed(1)} inside (floor ${P.oy.toFixed(1)})`); ok(await until(() => lab() === 'EXIT'), `just inside the door the button says "${lab()}"`);
    ok(c.scene.getObjectByName('interior').visible, 'the room is not shown'); ok(await until(() => !c.scene.getObjectByName('npcs').visible), 'the street crowd is still drawn inside');
    window.__P = P;
    // order a ginbilog, drink it
    let p = at(P, .5, -4.7); F.x = p.x; F.z = p.z; ok(await until(() => lab() === 'ORDER'), `at the counter the button says "${lab()}"`); $('bFoot').click();
    ok(await until(() => !$('shop').hidden), 'ORDER did not open the shop'); const m0 = SH.SHOP.money;
    [...$('shopL').querySelectorAll('.srow')].find(r => r.textContent.includes('Ginbilog')).querySelector('.b').click();
    ok(SH.SHOP.money === m0 - 75 && SH.SHOP.bag.ginbilog === 1, `buying: money ${m0} -> ${SH.SHOP.money}, bag ${JSON.stringify(SH.SHOP.bag)}`);
    p = at(P, 0, 3.4); F.x = p.x; F.z = p.z; ok(await until(() => $('shop').hidden), 'the shop stayed open after walking away');
    ok(await until(() => lab().startsWith('DRINK')), `with a drink in hand the button says "${lab()}"`); E.EF.drunk = 0; $('bFoot').click();
    ok(await until(() => E.EF.drunk > .7, 30000), `drinking did not make us drunk (${E.EF.drunk})`); ok(!SH.SHOP.bag.ginbilog, 'the bottle is still in the bag');
    ok(await until(() => R.DRUNK.pipe && R.DRUNK.k > .9), 'the drunk pass is not running'); await sleep(600);
    // pool: SHOOT moves the cue ball
    const tb = P.tables[0]; p = at(P, tb.p.x + 1.2, tb.p.z + .2); F.x = p.x; F.z = p.z; E.EF.drunk = 0;
    ok(await until(() => lab() === 'SHOOT'), `at the pool table the button says "${lab()}"`); const c0 = { ...tb.T.balls[0] }; $('bFoot').click();
    ok(await until(() => Math.hypot(tb.T.balls[0].x - c0.x, tb.T.balls[0].z - c0.z) > .2 || !tb.T.balls[0].on), 'SHOOT did not move the cue ball');
    // out again
    p = at(P, 0, P.d / 2 - .7); F.x = p.x; F.z = p.z; ok(await until(() => lab() === 'EXIT'), `by the door inside the button says "${lab()}"`); $('bFoot').click();
    ok(await until(() => !ctx.inside), 'EXIT did not take us out'); ok(Math.abs(F.x - d.x) < .01 && Math.abs(F.y - W.H(d.x, d.z)) < .05, 'not on the step outside after EXIT');
    ok(!c.scene.getObjectByName('interior').visible, 'the room is still drawn outside'); await sleep(300); ok(Math.abs(c.camera.position.y - F.y) < 6, `camera at y ${c.camera.position.y.toFixed(1)} after EXIT (walker at ${F.y.toFixed(1)}): it should snap, not glide down`); ok(Math.abs(c.camera.far - 300) > 1 || c.camera.far > 300, 'camera far plane not restored');
    return fails;
  });
  for (const f of A) errs.push('bar: ' + f);
  await snap('bar-done');
  /* ---------- B: friends ---------- */
  const B = await pg.evaluate(async () => {
    const c = window.__cpm, ctx = c.ctx, F = c.F, S = c.S, NET = c.NET, { until, sleep, at } = window.__h, fails = [], ok = (v, m) => { if (!v) fails.push(m); };
    const net = await import('./js/net.js'), SH = await import('./js/shop.js'), E = await import('./js/effects.js'), map = await import('./js/map.js'), $ = id => document.getElementById(id), vis = id => !$(id).hidden;
    const soc = op => window.__sent.filter(m => m.t === 'soc' && m.op === op);
    net.join('TEST', 'Me', 'wss://test.invalid'); const ws = window.__ws, J = m => ws.onmessage({ data: JSON.stringify(m) });
    J({ t: 'hi', id: 1, max: 8, peers: [{ id: 5, name: 'Ghost', look: { bike: 'raider150', parts: {} } }] }); ok(NET.st === 'on' && NET.peers.size === 1, 'could not join the fake room');
    const P = NET.peers.get(5), g = { x: F.x + 2, y: F.y, z: F.z, psi: 0 }, bike = { x: S.x + 6, y: S.zH, z: S.z };
    const pkt = (walk) => { const b = new ArrayBuffer(45), d = new DataView(b), p = walk ? g : bike; d.setUint8(0, 5); d.setUint8(1, 1); d.setUint8(2, walk ? 64 | 128 : 64); d.setUint32(5, performance.now() >>> 0, true);
      d.setFloat32(9, p.x, true); d.setFloat32(13, p.y, true); d.setFloat32(17, p.z, true); d.setInt16(23, Math.round(Math.sin((p.psi || 0) / 2) * 32767), true); d.setInt16(27, Math.round(Math.cos((p.psi || 0) / 2) * 32767), true); if (walk) d.setUint8(3, 200); return b; };
    let n = 0; const pump = setInterval(() => ws.onmessage({ data: pkt(n++ % 4 !== 0) }), 60);
    try {
      ok(await until(() => P.walk && P.walk.visible && P.d < 5, 30000), 'the friend\'s walker never showed up');
      ok(await until(() => Math.abs(P.walk.rotation.z) > .005, 5000), 'a drunk friend (byte 200) does not sway');
      NET.on.tap(P); ok(vis('soc') && $('socT').textContent.startsWith('Ghost'), `tapping on foot: "${$('socT').textContent}"`);
      [...$('socB').children].find(b => b.textContent.includes('WAVE')).click(); ok(soc('wave').length === 1 && soc('wave')[0].to === 5, 'WAVE sent nothing');
      NET.on.tap(P); [...$('socB').children].find(b => b.textContent.includes('TREAT')).click(); const m0 = SH.SHOP.money;
      const tb = [...$('socB').children].find(b => b.textContent.includes('🍶')); ok(tb, 'no ginbilog in the treat list'); if (tb) tb.click();
      ok(soc('treat').length === 1 && soc('treat')[0].item === 'ginbilog' && SH.SHOP.money === m0 - 75, `TREAT: sent ${JSON.stringify(soc('treat'))}, money ${m0} -> ${SH.SHOP.money}`);
      NET.on.tap(P); [...$('socB').children].find(b => b.textContent.includes('CALL')).click(); const cl = soc('call')[0]; ok(cl && Math.abs(cl.x - F.x) < .2 && Math.abs(cl.z - F.z) < .2, 'CALL did not send our spot');
      // incoming
      const bag0 = SH.SHOP.bag.beer | 0; J({ t: 'soc', op: 'treat', from: 5, item: 'beer' }); ok((SH.SHOP.bag.beer | 0) === bag0 + 1 && soc('thanks').length === 1, 'an incoming treat did not land in the bag / thank');
      J({ t: 'soc', op: 'treat', from: 5, item: 'nosuch' }); J({ t: 'soc', op: 'treat', from: 5, item: 'kape' }); ok(!SH.SHOP.bag.nosuch && !SH.SHOP.bag.kape, 'a treat that is not on the treat list was accepted');
      J({ t: 'soc', op: 'call', from: 5, x: 120, z: 40, place: 'Somewhere' }); ok(map.WP.on && map.WP.x === 120 && map.WP.n.includes('Ghost'), 'an incoming call did not set the waypoint');
      J({ t: 'soc', op: 'cheers', from: 5 }); ok(vis('soc') && $('socT').textContent.includes('raises a glass'), 'no CHEERS panel'); E.EF.drunk = 0;
      [...$('socB').children].find(b => b.textContent.includes('CHEERS')).click(); ok(soc('clink').length === 1, 'CHEERS back sent nothing');
      ok(await until(() => E.EF.drunk > 0, 30000), 'cheering back did not drink the beer we carry');
      ok(await until(() => window.__sent.some(m => m.raw && (m.bin & 128) && m.raw[2] > 0), 15000), 'our walker packets do not carry the drunk byte');
      // the friend walks into the bar's pocket: hidden while we're outside (tag says inside), drawn once we're in the same room
      const Pk = window.__P, ip = at(Pk, 1, 4); g.x = ip.x; g.z = ip.z; g.y = Pk.oy;
      ok(await until(() => P.pk === Pk.key && !P.walk.visible, 15000), `friend in the bar: pocket "${P.pk}" (want ${Pk.key}), drawn ${P.walk.visible}`);
      ok(await until(() => P.tag.textContent.includes('inside') || P.tag.hidden), `tag outside: "${P.tag.textContent}"`);
      const W = await import('./js/world.js'), d = Pk.door; F.x = d.x; F.z = d.z; F.y = W.H(d.x, d.z); await until(() => window.__h.lab() === 'ENTER'); $('bFoot').click();
      ok(await until(() => ctx.inside === Pk), 'could not enter again'); ok(await until(() => P.walk.visible, 15000), 'the friend inside the same room is not drawn');
      await sleep(400);
      ctx.exitInside(true);
    } finally { clearInterval(pump); }
    return fails;
  });
  for (const f of B) errs.push('friends: ' + f);
  await snap('friends-done');
  if (GPU && !(await pg.evaluate(() => !!window.__cpm.renderer.backend.isWebGPUBackend))) errs.push('--webgpu: the game is running on WebGL');
  if (!errs.length) console.log('places: ok (bar: enter, order, drink, pool, exit · friends: wave, treat, call, cheers, drunk byte, same-room walkers)');
} catch (e) { errs.push('harness: ' + e.message.split('\n')[0]); }
for (const e of errs) console.log('FAIL  ' + e);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
