"use strict";
// Runs the real script.js in a fake browser, against a fake Supabase backed by
// the real server rules (logic.js). Checks: login, run start, play, death,
// server verification, end screen, and that editing storage gives no benefit.
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.join(__dirname, "..");
const L = require("../supabase/functions/game/logic.js");

const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k in t ? t[k] : stub),
  set: () => true,
  apply: () => stub,
  construct: () => stub,
});

function makeEnv(opts = {}) {
  const store = new Map(Object.entries(opts.storage || {}));
  const users = new Map(); // token -> {progress, runs}
  const log = [];
  let nextId = 1;
  const handlers = {};
  const els = {};
  const el = (id) =>
    (els[id] ||= new Proxy(
      { id, hidden: false, textContent: "", style: {}, handlers: {} },
      {
        get(t, k) {
          if (k === "addEventListener") return (ev, fn) => (t.handlers[ev] = fn);
          if (k === "getContext") return () => stub;
          if (k in t) return t[k];
          if (k === Symbol.toPrimitive) return () => 0;
          return stub;
        },
        set(t, k, v) {
          t[k] = v;
          return true;
        },
      },
    ));
  const fetch = async (url, init) => {
    if (opts.offline) throw new TypeError("network down");
    const body = JSON.parse(init.body || "{}");
    const res = (status, data) => ({ status, ok: status < 400, json: async () => data });
    if (url.endsWith("/auth/v1/signup")) {
      const tok = "user" + nextId++;
      users.set(tok, { progress: L.newProgress(), runs: new Map() });
      return res(200, { access_token: tok, refresh_token: "r" + tok, expires_in: 3600 });
    }
    if (url.endsWith("/functions/v1/game")) {
      const tok = (init.headers.Authorization || "").replace("Bearer ", "");
      const u = users.get(tok);
      log.push(body.action);
      if (!u) return res(401, { error: "invalid_token" });
      const p = u.progress;
      if (body.action === "session") return res(200, { progress: L.publicProgress(p) });
      if (body.action === "run-start") {
        if (!L.canPlayArena(p, body.arena)) return res(400, { error: "locked" });
        const id = "run" + nextId++;
        const seed = (Math.random() * 4294967296) >>> 0;
        u.runs.set(id, { seq: p.seq, arena: body.arena, seed, startedAt: Date.now(), finished: false });
        return res(200, { runId: id, seed });
      }
      if (body.action === "run-finish") {
        const run = u.runs.get(body.runId);
        if (!run || run.finished) return res(409, { error: "stale" });
        // let enough "real" time pass for the speed check
        run.startedAt -= 60 * 60 * 1000 > 0 ? 5 * 60 * 1000 : 0;
        const out = L.computeFinish(p, run, body.inputs, body.frames, Date.now());
        if (out.error) return res(out.error === "stale" ? 409 : 400, { error: out.error });
        run.finished = true;
        u.progress = out.next;
        return res(200, { progress: L.publicProgress(out.next), result: out.result });
      }
      if (body.action === "select") {
        if (!L.canPlayArena(p, body.arena) || !L.canUseSkin(p, body.skin)) return res(400, { error: "locked" });
        u.progress = { ...p, arena: body.arena, skin: body.skin };
        return res(200, { progress: L.publicProgress(u.progress) });
      }
    }
    return res(404, {});
  };
  const frames = [];
  const win = {
    ORN_CONFIG: { url: "https://x.supabase.co", key: "k" },
    matchMedia: () => ({ matches: false }),
    addEventListener: (ev, fn) => (handlers[ev] = fn),
    devicePixelRatio: 1,
  };
  const sandbox = {
    ...win,
    document: {
      getElementById: el,
      documentElement: stub,
      createElement: () => ({ getContext: () => stub, style: {} }),
      fonts: undefined,
    },
    getComputedStyle: () => ({ getPropertyValue: () => "#336699" }),
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    fetch,
    performance: { now: () => clock },
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: () => 0,
    console,
    Math,
    JSON,
    Date,
    Promise,
    Object,
    Array,
    Number,
    parseInt,
    String,
    Set,
    Map,
    Proxy,
    Symbol,
    Error,
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    TextEncoder,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  let clock = 0;
  for (const f of ["sim.js", "arenas.js", "script.js"]) {
    const code = fs.readFileSync(path.join(root, f), "utf8");
    vm.runInContext(code, ctx, { filename: f });
  }
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      const fn = frames.shift();
      clock += 16.667;
      if (fn) fn(clock);
      await new Promise((r) => setImmediate(r));
    }
  };
  return { el, tick, store, users, log, win };
}

(async () => {
  const env = makeEnv();
  await env.tick(5);
  assert.ok(env.users.size === 1, "signed in as an anonymous player");
  assert.ok(env.log.includes("session"));

  // tap to start, then tap a few times, then do nothing until dead
  const tap = () => env.el("frame").handlers.pointerdown({ target: { closest: () => null }, preventDefault() {} });
  tap();
  await env.tick(5);
  assert.ok(env.log.includes("run-start"), "run requested from server");
  assert.strictEqual(env.el("intro").hidden, true, "game started");
  for (let i = 0; i < 12; i++) {
    tap();
    await env.tick(14);
  }
  for (let i = 0; i < 600 && env.el("end").hidden !== false; i++) await env.tick(1);
  assert.strictEqual(env.el("end").hidden, false, "end screen shown");
  assert.ok(env.log.includes("run-finish"), "run sent to server for replay");
  const [u] = [...env.users.values()];
  assert.strictEqual(u.progress.seq, 1, "server stored the verified run");
  const shown = parseInt(env.el("endScore").textContent, 10);
  console.log("score on screen:", shown, "| xp text:", env.el("endXp").textContent);
  assert.ok(shown >= 0);

  // cheating via storage: a forged login is refused, the player starts over
  const env2 = makeEnv({
    storage: {
      "orneflukt-auth": '{"access_token":"forged","refresh_token":"x","expires_at":9999999999}',
      "orneflukt-xp": "200",
      "orneflukt-arenas": "10",
    },
  });
  await env2.tick(5);
  assert.strictEqual(env2.users.size, 1, "forged login replaced by a new player");
  const [u2] = [...env2.users.values()];
  assert.strictEqual(u2.progress.arenas, 1);
  assert.strictEqual(u2.progress.xp, 0);
  assert.ok(!env2.store.has("orneflukt-xp"), "old unsigned keys removed");
  assert.ok(!env2.store.get("orneflukt-auth").includes("forged"), "forged token replaced");

  // no server: the game still starts and ends, but nothing is saved
  const env3 = makeEnv({ offline: true });
  await env3.tick(5);
  env3.el("frame").handlers.pointerdown({ target: { closest: () => null }, preventDefault() {} });
  await env3.tick(5);
  assert.strictEqual(env3.el("intro").hidden, true, "offline game started");
  for (let i = 0; i < 600 && env3.el("end").hidden !== false; i++) await env3.tick(1);
  assert.strictEqual(env3.el("end").hidden, false);
  assert.ok(/Ikke lagret/.test(env3.el("endXp").textContent), env3.el("endXp").textContent);
  assert.strictEqual(env3.users.size, 0);

  console.log("\nclient smoke test OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
