// headless stand-in for js/hud.js: on-screen messages are just collected (tests read them from globalThis.__says)
export const say = t => { (globalThis.__says || (globalThis.__says = [])).push(String(t)); };
