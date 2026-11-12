// Tiny entity-component-system (12.14). Headless: no DOM, no three, no globals; one world per simulation.
//   entity    = a number
//   component = a plain object in a named store (world.get(e, 'Body'))
//   system    = a function (world, dt) run in the order it was added; all state lives in components
//   resource  = world.res.<name>: things there is one of (the ground, the weather)
// Used by js/car/ (wheeled vehicles). A new kind of thing = new components + systems, no change here.
export function makeWorld() {
  const stores = new Map(), systems = [], alive = new Set(); let next = 1;
  const st = n => stores.get(n) || (stores.set(n, new Map()), stores.get(n));
  const W = {
    res: {}, alive, time: 0,
    spawn(comps) { const e = next++; alive.add(e); if (comps) for (const k in comps) st(k).set(e, comps[k]); return e; },
    kill(e) { if (alive.delete(e)) for (const s of stores.values()) s.delete(e); },
    add(e, n, c) { st(n).set(e, c); return c; },
    remove(e, n) { st(n).delete(e); },
    get(e, n) { return st(n).get(e); },
    has(e, n) { return st(n).has(e); },
    count(n) { return st(n).size; },
    // fn(e, a, b, c, d) for every entity that has all the named components (up to 4); no allocation per call
    each(names, fn) {
      const s0 = st(names[0]), s1 = names[1] && st(names[1]), s2 = names[2] && st(names[2]), s3 = names[3] && st(names[3]);
      for (const [e, a] of s0) {
        let b, c, d;
        if (s1 && (b = s1.get(e)) === undefined) continue;
        if (s2 && (c = s2.get(e)) === undefined) continue;
        if (s3 && (d = s3.get(e)) === undefined) continue;
        fn(e, a, b, c, d);
      }
    },
    system(name, fn) { systems.push({ name, fn }); return W; },
    systems: () => systems.map(s => s.name),
    step(dt) { for (let i = 0; i < systems.length; i++) systems[i].fn(W, dt); W.time += dt; },
  };
  return W;
}
