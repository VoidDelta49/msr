var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { DurableObject } from "cloudflare:workers";
var PROTO = 1;
var MAX = 8;
var ROOM = /^\/room\/([A-Za-z0-9]{4,8})$/;
var worker_default = {
  async fetch(req, env) {
    const u = new URL(req.url), m = u.pathname.match(ROOM);
    if (u.pathname === "/") return new Response(`cpm relay ok \xB7 proto ${PROTO} \xB7 max ${MAX}`, { headers: { "access-control-allow-origin": "*" } });
    if (!m) return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected a websocket", { status: 426 });
    return env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase())).fetch(req);
  }
};
var clean = /* @__PURE__ */ __name((s) => String(s || "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 16), "clean");
var Room = class extends DurableObject {
  static {
    __name(this, "Room");
  }
  // everyone in the room (the attachment survives hibernation)
  list(except) {
    const out = [];
    for (const w of this.ctx.getWebSockets()) {
      if (w === except) continue;
      const a = w.deserializeAttachment();
      if (a && a.id) out.push([w, a]);
    }
    return out;
  }
  async fetch(req) {
    const u = new URL(req.url), [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const bye = /* @__PURE__ */ __name((code, why, msg) => {
      server.send(JSON.stringify({ t: "err", code: why, msg }));
      server.close(code, why);
      return new Response(null, { status: 101, webSocket: client });
    }, "bye");
    if (+u.searchParams.get("v") !== PROTO) return bye(4e3, "proto", "The game and the server are different versions. Reload the page.");
    const peers = this.list(server);
    if (peers.length >= MAX) return bye(4001, "full", `This room is full (${MAX} players).`);
    const used = new Set(peers.map((p) => p[1].id));
    let id = 1;
    while (used.has(id)) id++;
    const me = { id, name: clean(u.searchParams.get("name")) || "Rider " + id, look: null };
    server.serializeAttachment(me);
    server.send(JSON.stringify({ t: "hi", id, max: MAX, now: Date.now(), peers: peers.map((p) => p[1]) }));
    this.bcast(JSON.stringify({ t: "join", id, name: me.name }), server);
    return new Response(null, { status: 101, webSocket: client });
  }
  bcast(data, except) {
    for (const [w] of this.list(except)) try {
      w.send(data);
    } catch (e) {
    }
  }
  async webSocketMessage(ws, msg) {
    const me = ws.deserializeAttachment();
    if (!me || !me.id) return;
    if (typeof msg !== "string") {
      if (msg.byteLength > 96) return;
      const out = new Uint8Array(msg.byteLength + 1);
      out[0] = me.id;
      out.set(new Uint8Array(msg), 1);
      this.bcast(out, ws);
      return;
    }
    if (msg.length > 4096) return;
    let m;
    try {
      m = JSON.parse(msg);
    } catch (e) {
      return;
    }
    if (!m || typeof m.t !== "string") return;
    if (m.t === "ping") {
      ws.send(JSON.stringify({ t: "pong", c: m.c, now: Date.now() }));
      return;
    }
    if (m.t === "look") {
      me.look = m.look;
      ws.serializeAttachment(me);
    }
    m.from = me.id;
    const data = JSON.stringify(m);
    if (m.to) {
      for (const [w, a] of this.list(ws)) if (a.id === m.to) try {
        w.send(data);
      } catch (e) {
      }
    } else this.bcast(data, ws);
    if (m.echo) ws.send(data);
  }
  async webSocketClose(ws, code) {
    this.gone(ws);
    try {
      ws.close(code === 1005 ? 1e3 : code, "bye");
    } catch (e) {
    }
  }
  async webSocketError(ws) {
    this.gone(ws);
  }
  gone(ws) {
    const me = ws.deserializeAttachment();
    if (!me || !me.id) return;
    ws.serializeAttachment({ id: 0 });
    this.bcast(JSON.stringify({ t: "leave", id: me.id }), ws);
  }
};

// ../../../../tmp/claude-0/-home-claude/295974d9-337a-52cf-bc78-475410fc9889/scratchpad/t/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../tmp/claude-0/-home-claude/295974d9-337a-52cf-bc78-475410fc9889/scratchpad/t/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ssRWBc/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../tmp/claude-0/-home-claude/295974d9-337a-52cf-bc78-475410fc9889/scratchpad/t/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ssRWBc/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Room,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
