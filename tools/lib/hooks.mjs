// Node ESM loader hooks: swap the browser-only modules the physics chain imports (hud.js, audio.js) for tiny stubs.
// Registered by headless.mjs; nothing here touches the game's own files.
const STUB = { 'hud.js': new URL('./stub-hud.mjs', import.meta.url).href, 'audio.js': new URL('./stub-audio.mjs', import.meta.url).href };
export async function resolve(spec, ctx, next) {
  const m = /^\.\/(hud|audio)\.js$/.exec(spec);
  if (m && ctx.parentURL && /\/js\/[^/]+\.js/.test(ctx.parentURL)) return { url: STUB[m[1] + '.js'], shortCircuit: true };
  return next(spec, ctx);
}
