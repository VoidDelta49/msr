// Shared mutable game state. S = the ridden bike's physics state; ctx = everything else modules share.
export const S = {};
export const ctx = {
  bikes: {},      // id -> bike definition (data/bikes/*.json)
  bike: null,     // current bike definition
  bcfg: null,     // current bike's saved settings
  spec: null,     // computed spec (bike data + garage parts)
  drive: null,    // drivetrain implementation (manual / cvt)
  GAR: false, OPT: false, paused: true, camMode: 0,
};
