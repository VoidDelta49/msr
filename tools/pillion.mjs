#!/usr/bin/env node
// Pillion passengers in a real browser (WebGL 2, like smoke.mjs; skips itself with exit 0 when there is no playwright / chromium):
//   PW=/path/to/node_modules/playwright node tools/pillion.mjs [--bike id] [--shot dir]
// A  every bike: the passenger is the rider's own mesh again (shared position buffer, own colours), sits on the pillion seat like the rider
//    sits on theirs (a ray down onto the real bike model: the passenger's hip must hug the seat the same way the rider's does), clear of the
//    rider's back, and chassis.pil.x / .h (the physics numbers) agree with where the model puts the passenger. --shot dir: side + 3/4 views.
// B  the whole ride through a fake relay socket and a fake rider (ghost bike #5 next to us, fed with the same binary packets net.js sends):
//    tap the name tag -> RIDE -> OK -> aboard (camera on the seat, own bike put away, flag 32, we follow the ghost) -> the ghost crashes
//    (passenger flung, back on foot next to the bike) -> then WE drive: ask arrives, OK, the mass / centre of mass change, the figure
//    shows, the seat list goes out, OFF restores the bike exactly, switching bikes drops the passenger. Also the tricycle's bench still works.
// C  on foot + multiplayer: our packets say "on foot" (flag 64) and carry the walker (flag 128) that a receiver draws as a standing figure
//    (fed back in as a ghost); a ghost that gets off loses its rider and can't be boarded; asking for a ride while walking lands us on the
//    seat cleanly (feet, camera, figure off) and GET OFF puts us back on our own bike; getting off our own bike drops our passenger; and
//    the FOV setting (pinch / wheel / Options) reaches the camera.
// Nothing here touches the network: WebSocket is replaced by a stub that records what the game sends.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serve } from './serve.mjs';

const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
let pw; try { pw = createRequire(import.meta.url)(process.env.PW || 'playwright-core'); } catch { console.log('pillion: skipped (playwright not found; see header of tools/smoke.mjs)'); process.exit(0); }
const srv = await serve(0), url = `http://localhost:${srv.address().port}/`, errs = [], shot = opt('--shot');
let br; try { br = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); } catch (e) { console.log('pillion: skipped (no chromium)'); srv.close(); process.exit(0); }
const pg = await br.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
if (shot) mkdirSync(shot, { recursive: true });
const rows = [];
try {
  await pg.addInitScript(() => {
    sessionStorage.setItem('cpmGL', '1'); localStorage.setItem('cpmme', JSON.stringify({ tod: 12, bike: 'raider150' }));
    window.__sent = []; // what the game sends: JSON as objects, binary as { bin: flags byte }
    window.WebSocket = class { constructor(u) { this.url = u; this.readyState = 1; this.bufferedAmount = 0; this.binaryType = 'arraybuffer'; window.__ws = this; } send(d) { window.__sent.push(typeof d === 'string' ? JSON.parse(d) : { bin: new Uint8Array(d)[1], raw: new Uint8Array(d).slice() }); } close() { } };
  });
  await pg.goto(url); await pg.click('#mPlay');
  await pg.waitForFunction(() => window.__cpm && window.__cpm.RP && window.__cpm.RP.ok, null, { timeout: 120000 });
  const ids = opt('--bike') ? [opt('--bike')] : await pg.evaluate(() => Object.keys(window.__cpm.ctx.bikes));

  /* ---------- A: every bike ---------- */
  for (const id of a.includes('--flow-only') ? [] : ids) {
    rows.push(await pg.evaluate(async ([id, shot]) => {
      const c = window.__cpm, THREE = await import('three'), R = await import('./js/ride.js'), sleep = ms => new Promise(r => setTimeout(r, ms));
      c.setBike(id); await sleep(400); const B = c.B, G = B.G, sp = c.ctx.spec, pil = G.pil, out = { id, fails: [] }, bad = m => out.fails.push(m);
      if (!pil) { bad('no B.G.pil (chassis.pil missing?)'); return out; }
      R._t.drawSeats('A', { body: B.body, kind: 'pillion', G, rider: B.rider }, [3, 0], true);
      const m = B.body.children.find(o => o.userData && o.userData.hip); if (!m) { bad('no pillion mesh was drawn'); return out; }
      const rm = B.rider[0], pa = m.geometry.attributes, ra = rm.geometry.attributes;
      out.draws = 1; out.tris = (m.geometry.index ? m.geometry.index.count : pa.position.count) / 3;
      if (pa.position !== ra.position || pa.normal !== ra.normal) bad('the passenger does not share the rider\'s position / normal buffers');
      let diff = 0; for (let i = 0; i < pa.color.array.length; i++) if (pa.color.array[i] !== ra.color.array[i]) diff++; if (diff < 100) bad(`only ${diff} colour values differ from the rider (not recoloured?)`);
      const k4 = R._t.kindOf({ bike: id, parts: {} }); if (k4 !== 'pillion') bad(`kindOf gives "${k4}" for a plain ${id}`);
      // rider and passenger in the bike's frame (ct): boxes of the two meshes
      // torso slices at equal heights (|x| < .19; arms and legs reach past each other on purpose): the rider's back surface against the passenger's
      // chest surface. Smallest gap over the slices; < 0: they interpenetrate, a lot more than 0.12: the passenger floats behind the rider
      const [hy0] = B.hip, pp = rm.geometry.attributes.position; let gap = 9;
      for (let y0 = hy0 + .15; y0 < hy0 + .5; y0 += .05) {
        let back = -9, front = 9; for (let i = 0; i < pp.count; i++) { const x = pp.getX(i); if (Math.abs(x) > .19) continue; const y = pp.getY(i), z = pp.getZ(i); if (Math.abs(y - y0) < .035) back = Math.max(back, z); if (Math.abs(y + pil.dy - y0) < .035) front = Math.min(front, z + pil.dz); }
        if (back > -9 && front < 9) gap = Math.min(gap, front - back);
      }
      out.overlapZ = +gap.toFixed(3);
      if (out.overlapZ < -.05) bad(`passenger's chest is ${-out.overlapZ} m inside the rider's back (more dz?)`); if (out.overlapZ > .12) bad(`passenger floats ${out.overlapZ} m behind the rider's back (less dz?)`);
      // seat height under the rider's hip and under the passenger's hip: a ray down onto the real bike
      B.root.position.set(0, 0, 0); B.root.rotation.set(0, 0, 0); B.root.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(), seatY = z => { rc.set(B.ct.localToWorld(new THREE.Vector3(0, 2.2, z)), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObject(B.skin, false)[0]; return h ? B.ct.worldToLocal(h.point.clone()).y : null; };
      const [hy, hz] = B.hip, sr = seatY(hz), sp2 = seatY(hz + pil.dz); out.hip = [+hy.toFixed(3), +hz.toFixed(3)];
      if (sr == null || sp2 == null) bad(`no seat under the hip (rider ${sr}, passenger ${sp2}): dz puts the passenger off the bike`);
      else {
        out.riderGap = +(hy - sr).toFixed(3); out.paxGap = +(hy + pil.dy - sp2).toFixed(3);
        if (Math.abs(out.paxGap - out.riderGap) > .05) bad(`passenger's hip is ${out.paxGap} m above the seat, the rider's ${out.riderGap} m (dy ${pil.dy} should be about ${+(pil.dy - (out.paxGap - out.riderGap)).toFixed(2)})`);
      }
      // physics numbers vs the model
      const px = G.rearZ - (hz + pil.dz), ph = hy + pil.dy + .27; out.x = +px.toFixed(2); out.h = +ph.toFixed(2);
      if (Math.abs(px - sp.pil.x) > .05) bad(`chassis.pil.x ${sp.pil.x} but the model puts the passenger's hip ${out.x} m ahead of the rear axle`);
      if (Math.abs(ph - sp.pil.h) > .1) bad(`chassis.pil.h ${sp.pil.h} but the model puts the passenger's centre of mass ${out.h} m up`);
      if (shot) { // garage studio: rider + passenger forced visible (the garage hides riders)
        B.rider.forEach(r => { r.visible = true; }); Object.defineProperty(m, 'visible', { get: () => true, set: () => { } });
      }
      out.keep = true; return out;
    }, [id, !!shot]));
    const r = rows[rows.length - 1];
    if (shot && r.keep) {
      await pg.evaluate(() => document.getElementById('bGar').click()); await pg.waitForTimeout(2500); await pg.addStyleTag({ content: '#garage{visibility:hidden!important} #wheelHint{display:none}' });
      await pg.evaluate(() => { const c = window.__cpm, m = c.B.body.children.find(o => o.userData && o.userData.hip) || window.__pm; window.__pm = m; clearInterval(window.__pi); window.__pi = setInterval(() => { if (m && m.parent !== c.B.body) c.B.body.add(m); c.B.rider.forEach(r => { r.visible = true; }); }, 50); }); // the garage's own ride frame drops the figure each frame, so the shot keeps putting it back
      for (const [name, v] of [['side', { az: Math.PI / 2, el: .04, r: 2.2, ty: .9, tz: 0 }], ['3q', { az: 2.5, el: .2, r: 2.2, ty: .9, tz: 0 }]]) {
        await pg.evaluate(async v => (await import('./js/studio.js')).view(v), v); await pg.waitForTimeout(4500); await pg.screenshot({ path: path.join(shot, `${id}-${name}.png`), timeout: 120000 });
      }
      await pg.evaluate(() => clearInterval(window.__pi)); await pg.evaluate(() => document.getElementById('gClose').click()); await pg.waitForTimeout(400);
    }
    await pg.evaluate(async () => { const B = window.__cpm.B; const m = B.body.children.find(o => o.userData && o.userData.hip); if (m) m.removeFromParent(); });
  }

  /* ---------- B: the ride, through a fake relay ---------- */
  // headless swiftshader runs at a few frames per second, so everything the game does per frame is waited for with until(), never a fixed sleep
  const flow = await pg.evaluate(async () => {
    const c = window.__cpm, NET = c.NET, ctx = c.ctx, S = c.S, B = c.B, R = await import('./js/ride.js'), net = await import('./js/net.js');
    const fails = [], ok = (cond, msg) => { if (!cond) fails.push(msg); }, sleep = ms => new Promise(r => setTimeout(r, ms)); let stage = 'start';
    const until = async (f, ms = 8000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (f()) return true; await sleep(40); } return !!f(); };
    const sentOps = () => window.__sent.filter(m => m.t === 'ride').map(m => m.op), $ = id => document.getElementById(id), vis = id => !$(id).hidden;
    const figOn = body => body.children.find(o => o.userData && o.userData.hip);
    try {
      c.setBike('raider150'); await sleep(300); c.reset(); S.v = 0; if (ctx.camMode === 0) c.toggleCam(); // third person: the passenger's figure is drawn
      net.join('TEST', 'Me', 'wss://test.invalid'); const ws = window.__ws;
      const J = m => ws.onmessage({ data: JSON.stringify(m) });
      J({ t: 'hi', id: 1, max: 8, peers: [{ id: 5, name: 'Ghost', look: { bike: 'raider150', parts: {} } }] });
      ok(NET.st === 'on' && NET.peers.size === 1, 'could not join the fake room');
      const P = NET.peers.get(5), gh = { x: S.x + 3, y: S.zH, z: S.z, psi: S.psi, fl: 1, v: 0 };
      const pkt = () => { const b = new ArrayBuffer(45), d = new DataView(b), q = [0, Math.sin(gh.psi / 2), 0, Math.cos(gh.psi / 2)]; d.setUint8(0, 5); d.setUint8(1, 1); d.setUint8(2, gh.fl); d.setUint16(3, 4000, true); d.setUint32(5, performance.now() >>> 0, true);
        d.setFloat32(9, gh.x, true); d.setFloat32(13, gh.y, true); d.setFloat32(17, gh.z, true); q.forEach((v, i) => d.setInt16(21 + 2 * i, Math.round(v * 32767), true));
        d.setInt16(37, Math.round((P.tpl ? P.tpl.h.rearH.position.y : .3) * 1e4), true); d.setInt16(35, Math.round((P.tpl ? P.tpl.h.slider.position.y : -.7) * 1e4), true); d.setInt16(39, 6200, true); d.setInt16(41, Math.round(gh.v * 100), true); return b; };
      const pump = setInterval(() => ws.onmessage({ data: pkt() }), 100), place = (dx, dz) => { gh.x = S.x + dx; gh.z = S.z + dz; gh.y = S.zH; };
      ok(await until(() => P.inst && P.inst.o.visible && P.snaps.length > 3 && P.d < 6, 30000), 'the ghost bike never showed up');
      ok(R._t.kindOf(P.look) === 'pillion', 'a plain Raider should be a pillion host'); ok(R._t.canBoard(P), 'canBoard should be true next to a stopped bike');
      ok(ctx.rideIcon(P).includes('+1'), `name tag icon "${ctx.rideIcon(P)}"`);
      stage = 'tap';
      NET.on.tap(P); ok(vis('ride') && $('rideT').textContent === 'Hop on behind Ghost?' && vis('rideY') && vis('rideB'), `tap panel: "${$('rideT').textContent}"`);
      $('rideY').click(); ok(sentOps().includes('ask'), 'RIDE did not send an ask'); ok($('rideT').textContent.startsWith('Asking'), 'no "Asking…" panel');
      stage = 'refusal';
      J({ t: 'ride', op: 'no', from: 5, why: 'full' }); ok(!vis('ride') && !ctx.ride, 'a "full" answer should close the panel and not board');
      NET.on.tap(P); $('rideY').click(); J({ t: 'ride', op: 'ok', from: 5, seat: 0 });
      ok(ctx.ride && ctx.ride.kind === 'pillion' && ctx.ride.host === 5, 'did not board');
      ok(vis('ride') && $('rideT').textContent === '🏍️ Riding with Ghost', `riding panel "${$('rideT').textContent}"`);
      ok(B.root.visible === false, 'own bike should be put away'); ok(Math.abs(B.cam.position.x - P.tpl.G.pil.cam.x) < 1e-6 && Math.abs(B.cam.position.z - P.tpl.G.pil.cam.z) < 1e-6, `camera at ${B.cam.position.toArray()} not on the passenger seat ${JSON.stringify(P.tpl.G.pil.cam)}`);
      J({ t: 'ride', op: 'seats', from: 5, seats: [1, 0] });
      const body = P.inst.h.body; ok(await until(() => { const m = figOn(body); return m && m.visible; }), 'the passenger mesh is not drawn on the ghost (third person)');
      const pm = figOn(body); ok(pm && pm.geometry.attributes.position === P.inst.h.rider[0].geometry.attributes.position, 'ghost passenger does not share the ghost rider\'s buffers');
      ok(await until(() => window.__sent.some(m => m.bin !== undefined && (m.bin & 32)), 12000), 'our packets do not carry flag 32 (bike put away)');
      stage = 'follow';
      gh.v = 6; for (let i = 0; i < 12; i++) { gh.z -= .6; await sleep(100); } ok(await until(() => Math.hypot(S.x - P.inst.o.position.x, S.z - P.inst.o.position.z) < .1), 'we do not follow the ghost'); ok(S.v > 2, `speed while riding along ${S.v}`);
      gh.v = 0; await sleep(300);
      stage = 'crash';
      gh.fl |= 2; ok(await until(() => ctx.rideFly, 12000), 'no cartoon fling for the passenger'); ok(pm && !pm.visible, 'the passenger mesh should be hidden on the crashed bike');
      ok(await until(() => !ctx.ride, 60000), 'never got back after the fling'); ok(B.root.visible === true, 'own bike did not come back'); ok(Number.isFinite(S.x) && Number.isFinite(S.z), 'non-finite position after the fling');
      gh.fl = 1; J({ t: 'ride', op: 'seats', from: 5, seats: [0, 0] }); P.flyT = 0; await sleep(300);
      stage = 'host';
      c.reset(); S.v = 0; await sleep(300); place(2.5, 0); ok(await until(() => P.d < 6 && !(P.fl & 2)), 'ghost did not come back next to us'); window.__sent.length = 0;
      const sp0 = { m: ctx.spec.m, lf: ctx.spec.lf, lr: ctx.spec.lr, h: ctx.spec.h, I: ctx.spec.I };
      J({ t: 'ride', op: 'ask', from: 5 });
      ok(vis('ride') && $('rideT').textContent === 'Ghost wants to ride on the back', `host panel "${$('rideT').textContent}"`);
      $('rideY').click();
      ok(sentOps().includes('ok'), 'OK did not answer'); const okMsg = window.__sent.find(m => m.op === 'ok'); ok(okMsg && okMsg.seat === 0 && okMsg.to === 5, 'ok must name seat 0');
      ok(await until(() => Math.abs(ctx.spec.m - sp0.m - 65) < 1e-6), `mass ${ctx.spec.m} should be ${sp0.m + 65}`); ok(ctx.spec.lr < sp0.lr - .05 && ctx.spec.lf > sp0.lf + .05 && ctx.spec.h > sp0.h + .05 && ctx.spec.I > sp0.I, 'centre of mass / inertia did not move');
      ok(Math.abs(ctx.spec.lf + ctx.spec.lr - ctx.spec.wb) < 1e-9, 'lf + lr != wb with a passenger');
      ok(await until(() => { const m = figOn(B.body); return m && m.visible; }), 'our own passenger figure is not drawn'); ok(await until(() => window.__sent.some(m => m.op === 'seats' && m.seats[0] === 5 && m.seats[1] === 0), 12000), 'seat list [5,0] was not broadcast');
      stage = 'full';
      J({ t: 'ride', op: 'ask', from: 5 }); ok(window.__sent.some(m => m.op === 'no' && m.why === 'full'), 'a full bike should answer "full"');
      await sleep(500); ok(Number.isFinite(S.x) && Number.isFinite(S.zH) && Math.abs(S.th) < .5, 'bike state went bad with a passenger');
      const mine = figOn(B.body);
      J({ t: 'ride', op: 'off', from: 5 });
      ok(await until(() => ctx.spec.m === sp0.m), 'spec still loaded after the passenger left'); ok(ctx.spec.lf === sp0.lf && ctx.spec.lr === sp0.lr && ctx.spec.h === sp0.h && ctx.spec.I === sp0.I, 'bike was not restored exactly after the passenger left'); ok(await until(() => mine && !mine.visible), 'figure still drawn after OFF');
      stage = 'switch';
      window.__sent.length = 0; J({ t: 'ride', op: 'ask', from: 5 }); $('rideY').click(); ok(R._t.R.seats[0] === 5, 'could not board again');
      c.setBike('click125'); ok(await until(() => R._t.R.seats[0] === 0 && window.__sent.some(m => m.op === 'off' && m.to === 5)), 'the passenger stayed aboard after switching bikes'); ok(ctx.spec.m === ctx.spec.base.m, 'spec still loaded after switching bikes');
      stage = 'trike';
      J({ t: 'look', from: 5, look: { bike: 'tmx155', parts: { sidecar: 1 } } }); ok(await until(() => P.tpl && P.tpl.kind === 'tmx' && P.inst.o.visible && P.d < 9, 30000), 'tricycle model never built');
      ok(R._t.kindOf(P.look) === 'trike' && await until(() => R._t.canBoard(P)), 'a TMX with the sidecar should be a trike host'); NET.on.tap(P); ok($('rideT').textContent === "Ride in Ghost's sidecar?", `trike panel "${$('rideT').textContent}"`); $('rideX').click();
      J({ t: 'ride', op: 'seats', from: 5, seats: [1, 7] });
      const bench = () => P.inst.h.body.children.filter(o => !o.userData.hip && o.geometry && o.geometry.attributes.color && o.material.vertexColors && o.position.x > .5);
      ok(await until(() => bench().length === 2 && bench().every(o => o.visible)), `sidecar bench shows ${bench().length} figures`);

      /* ---------- C: on foot ---------- */
      stage = 'C'; const F = (await import('./js/foot.js')).F, { camera } = await import('./js/renderer.js'), key = code => dispatchEvent(new KeyboardEvent('keydown', { code }));
      const cfg = (await import('./js/config.js')).cfg;
      c.setBike('raider150'); await sleep(300); c.reset(); S.v = 0; J({ t: 'look', from: 5, look: { bike: 'raider150', parts: {} } }); J({ t: 'ride', op: 'seats', from: 5, seats: [0, 0] }); gh.fl = 1; place(3, 0);
      ok(await until(() => P.tpl && P.tpl.kind !== 'tmx' && P.inst.o.visible && P.d < 6, 30000), 'C: ghost raider did not come back');
      // FOV: what the player sets is what the camera gets (the apply line was commented out by mistake in 11.38)
      const f0 = cfg.fov; cfg.fov = 61; ok(await until(() => Math.abs(camera.fov - 61) < .6), `C: cfg.fov 61 but camera.fov ${camera.fov}`); cfg.fov = f0;
      // a ghost that gets off: no rider on its bike, can't be boarded, no ride icon; its walker packets draw a standing figure
      gh.fl = 64; ok(await until(() => P.inst.h.rider.every(r => !r.visible)), 'C: ghost on foot still shows its rider on the bike');
      ok(!R._t.canBoard(P) && !ctx.rideIcon(P), 'C: a parked bike whose rider walked off should not offer a ride');
      const wk = { x: S.x - Math.sin(S.psi) * 7, y: S.zH, z: S.z - Math.cos(S.psi) * 7, psi: 1 }; // in front of us: in view of the chase camera
      const wpkt = () => { const b = new ArrayBuffer(45), d = new DataView(b); d.setUint8(0, 5); d.setUint8(1, 1); d.setUint8(2, 64 | 128); d.setUint32(5, performance.now() >>> 0, true);
        d.setFloat32(9, wk.x, true); d.setFloat32(13, wk.y, true); d.setFloat32(17, wk.z, true); d.setInt16(23, Math.round(Math.sin(wk.psi / 2) * 32767), true); d.setInt16(27, Math.round(Math.cos(wk.psi / 2) * 32767), true); d.setInt16(41, 280, true); return b; };
      const wpump = setInterval(() => ws.onmessage({ data: wpkt() }), 100);
      ok(await until(() => P.walk && P.walk.visible && Math.hypot(P.walk.position.x - wk.x, P.walk.position.z - wk.z) < .2, 15000), `C: ghost walker not drawn at its spot (${P.walk && P.walk.visible} ${P.walk && P.walk.position.toArray().map(v => v.toFixed(2))} want ${wk.x.toFixed(2)},${wk.z.toFixed(2)} fl ${P.fl} ws ${P.ws && P.ws.length} d ${P.d.toFixed(1)} GAR ${!!ctx.GAR})`);
      ok(P.walk && Math.abs(P.walk.rotation.y - 1) < .05, 'C: ghost walker heading');
      ok(P.inst.o.visible && Math.hypot(P.inst.o.position.x - gh.x, P.inst.o.position.z - gh.z) < .2, 'C: the parked ghost bike should stay where it was (walker packets must not move it)');
      clearInterval(wpump); gh.fl = 1; ok(await until(() => !P.walk.visible && P.inst.h.rider.every(r => r.visible)), 'C: ghost back on its bike: walker should go, rider come back');
      // we get off: flag 64 on bike packets, flag 128 walker packets with our feet in them
      window.__sent.length = 0; key('KeyF'); ok(await until(() => F.on), 'C: could not get off (F)');
      ok(await until(() => window.__sent.some(m => m.bin !== undefined && (m.bin & 64) && !(m.bin & 128)) && window.__sent.some(m => m.bin !== undefined && (m.bin & 192) === 192), 8000), 'C: no on-foot bike packet (64) and walker packet (64|128) went out');
      const wp = [...window.__sent].reverse().find(m => m.bin !== undefined && (m.bin & 128)), wd = wp && new DataView(wp.raw.buffer);
      ok(wd && Math.abs(wd.getFloat32(8, true) - F.x) < 1 && Math.abs(wd.getFloat32(16, true) - F.z) < 1, 'C: walker packet does not carry the walker position');
      // ...ask for a ride while walking: the ride works and nothing of the walk is left over
      ok(await until(() => R._t.canBoard(P)), `C: canBoard false from foot (d ${P.d.toFixed(1)} kind ${R._t.kindOf(P.look)} look ${JSON.stringify(P.look)} fl ${P.fl} seats ${P.seats} v ${S.v} cr ${S.crashed} sc ${ctx.spec.sc} R ${R._t.R.seats})`); NET.on.tap(P); ok($('rideT').textContent === 'Hop on behind Ghost?', `C: tap panel from foot "${$('rideT').textContent}"`);
      $('rideY').click(); J({ t: 'ride', op: 'ok', from: 5, seat: 0 });
      ok(ctx.ride && !F.on && !document.body.classList.contains('foot') && !B.root.visible, `C: boarding from foot: ride ${!!ctx.ride} F.on ${F.on} foot class ${document.body.classList.contains('foot')}`);
      ok(await until(() => window.__sent.some(m => m.bin !== undefined && (m.bin & 32) && !(m.bin & 64))), 'C: riding along should send flag 32 without 64');
      $('rideY').click(); ok(await until(() => !ctx.ride && B.root.visible && !F.on), 'C: GET OFF after boarding from foot did not bring the bike back');
      ok(await until(() => $('bFoot').textContent === 'GET OFF'), 'C: the GET OFF button should be back for our own bike');
      // the driver walks off: we are let off
      J({ t: 'ride', op: 'ask', from: 5 }); ok(vis('ride'), 'C: no ask panel'); $('rideX').click();
      place(2.5, 0); NET.on.tap(P); $('rideY').click(); J({ t: 'ride', op: 'ok', from: 5, seat: 0 }); ok(ctx.ride, 'C: could not board for the walk-off test');
      gh.fl = 64; ok(await until(() => !ctx.ride && B.root.visible), 'C: the driver got off but we stayed on the seat'); gh.fl = 1;
      // we drive, our passenger is dropped when we get off
      await sleep(300); window.__sent.length = 0; J({ t: 'ride', op: 'ask', from: 5 }); $('rideY').click(); ok(R._t.R.seats[0] === 5, 'C: could not take a passenger');
      key('KeyF'); ok(await until(() => F.on), 'C: could not get off with a passenger');
      ok(await until(() => R._t.R.seats[0] === 0 && window.__sent.some(m => m.op === 'off' && m.to === 5)), 'C: getting off our bike did not drop the passenger');
      key('KeyF'); ok(await until(() => !F.on), 'C: could not get back on');
      clearInterval(pump);
    } catch (e) { fails.push(`exception after "${stage}": ${e.message}`); }
    return { fails };
  });
  for (const f of flow.fails) errs.push('flow: ' + f);
} catch (e) { errs.push('harness: ' + (e.message || e).split('\n')[0]); }
console.log('bike'.padEnd(11) + 'tris'.padStart(5) + '  backGap  rider/pax seat gap  model x / h');
for (const r of rows) { console.log(r.id.padEnd(11) + String(r.tris ?? '-').padStart(5) + String(r.overlapZ ?? '-').padStart(10) + `  ${r.riderGap ?? '-'} / ${r.paxGap ?? '-'}`.padEnd(15) + `  ${r.x ?? '-'} / ${r.h ?? '-'}`); for (const f of r.fails || []) errs.push(`${r.id}: ${f}`); }
for (const e of errs) console.log('FAIL  ' + e);
if (!errs.length) console.log(`pillion: ok (${rows.length} bikes, ride flow through a fake relay)`);
await br.close(); srv.close(); process.exit(errs.length ? 1 : 0);
