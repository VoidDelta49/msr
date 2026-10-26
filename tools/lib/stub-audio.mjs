// headless stand-in for js/audio.js: sound events are counted by type (globalThis.__blips)
export const blip = t => { const b = globalThis.__blips || (globalThis.__blips = {}); b[t] = (b[t] || 0) + 1; };
export const crank = () => { };
