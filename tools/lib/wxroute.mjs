// Browser tools: answer the game's live-weather request (js/wxnet.js -> <relay>/wx) here instead of on the internet. No network
// needed, no 404 from a deployed relay that is older than the game, and the same sky on every run (clear, unless a tool passes its
// own snapshot: smoke.mjs sends rain to exercise the live path), so pictures and timings stay comparable.
export const WX_CLEAR = { c: 12, p: 0, r: 0, th: 0, w: 8, d: 20, v: 240, k: 30, h: 65 };
export async function wxRoute(pg, snap = WX_CLEAR, onAsk) {
  await pg.route('**/wx', r => { if (onAsk) onAsk(); r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ t: Math.floor(Date.now() / 9e5) * 900, th: 0, ...snap }) }); });
}
