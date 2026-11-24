// Runs the real client (lib/game/client.ts) with a fake browser, against the
// real server handler (lib/server/game.ts) on an in-memory database. Checks:
// login cookie, run start, play, death, server verification, end screen,
// that editing storage gives no benefit, and that script-made input is ignored.
import assert from "node:assert";
import { openDb } from "../lib/server/db";
import { handleGame } from "../lib/server/game";

/* eslint-disable @typescript-eslint/no-explicit-any -- the fake browser below is
   deliberately loose: any property of a fake element or canvas just works */
type Fn = (...args: any[]) => any;
type Event = { isTrusted?: boolean; code?: string; target?: any; preventDefault?: Fn };
type FakeEl = {
  id: string;
  hidden: boolean;
  textContent: string;
  value?: string;
  style: object;
  handlers: Record<string, Fn>;
  children: any[];
};
// elements made with document.createElement (class chips ...): clickable in tests
type MadeEl = { textContent: string; handlers: Record<string, Fn>; className: string };

const stub: any = new Proxy(function () {}, {
  get: (t: any, k) => (k === Symbol.toPrimitive ? () => 0 : k in t ? t[k] : stub),
  set: () => true,
  apply: () => stub,
  construct: () => stub,
});

let envCount = 0;
async function makeEnv(
  opts: { storage?: Record<string, string>; cookie?: string; offline?: boolean } = {},
) {
  const db = openDb(":memory:");
  const store = new Map(Object.entries(opts.storage || {}));
  let cookie = opts.cookie || null; // the browser's cookie jar
  const log: unknown[] = [];
  const handlers: Record<string, Fn> = {};
  const els: Record<string, FakeEl> = {};
  const el = (id: string): FakeEl =>
    (els[id] ||= new Proxy<FakeEl>(
      { id, hidden: false, textContent: "", style: {}, handlers: {}, children: [] },
      {
        get(t: any, k) {
          if (k === "addEventListener")
            return (ev: string, fn: Fn) => (t.handlers[ev] = fn);
          if (k === "appendChild") return (c: unknown) => t.children.push(c);
          if (k === "getContext") return () => stub;
          if (k in t) return t[k];
          if (k === Symbol.toPrimitive) return () => 0;
          return stub;
        },
        set(t: any, k, v) {
          t[k] = v;
          return true;
        },
      },
    ));
  const fetch = async (url: string, init: { body?: string }) => {
    if (opts.offline) throw new TypeError("network down");
    assert.strictEqual(url, "/api/game");
    const body = JSON.parse(init.body || "{}");
    log.push(body.action);
    if (body.action === "run-finish")
      // let enough "real" time pass for the speed check
      db.prepare("update runs set started_at = started_at - 600000 where id = ?").run(body.runId);
    const res = await handleGame(
      db,
      new Request("http://localhost/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: init.body,
      }),
    );
    // the browser's cookie jar: ff_player and (when logged in) ff_account
    const jar = new Map((cookie || "").split("; ").filter(Boolean).map((c) => c.split("=") as [string, string]));
    for (const c of res.headers.getSetCookie()) {
      const [k, v] = c.split(";")[0].split("=");
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
    cookie = jar.size ? [...jar].map(([k, v]) => k + "=" + v).join("; ") : null;
    return res;
  };
  const frames: Fn[] = [];
  const made: MadeEl[] = [];
  let clock = 0;
  const g: Record<string, unknown> = {
    window: null,
    matchMedia: () => ({ matches: false }),
    addEventListener: (ev: string, fn: Fn) => (handlers[ev] = fn),
    devicePixelRatio: 1,
    document: {
      getElementById: el,
      documentElement: stub,
      createElement: () => {
        const e: any = {
          getContext: () => stub,
          style: {},
          textContent: "",
          className: "",
          handlers: {},
          addEventListener(ev: string, fn: Fn) {
            e.handlers[ev] = fn;
          },
          setAttribute() {},
          appendChild() {},
          classList: { toggle() {}, add() {}, remove() {} },
          children: [],
        };
        made.push(e);
        return e;
      },
      fonts: undefined,
    },
    getComputedStyle: () => ({ getPropertyValue: () => "#336699" }),
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k) : null),
      setItem: (k: string, v: unknown) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    },
    navigator: {},
    fetch,
    performance: { now: () => clock },
    requestAnimationFrame: (fn: Fn) => frames.push(fn),
    setTimeout: () => 0,
  };
  g.window = g;
  // a fresh browser: put the fakes on globalThis, then load a fresh copy of the client
  for (const [k, v] of Object.entries(g))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const client = await import("../lib/game/client.ts?env=" + ++envCount);
  client.startGame();
  assert.ok(!("Sim" in globalThis) && !("flaksebot" in globalThis), "nothing global");
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      const fn = frames.shift();
      clock += 16.667;
      if (fn) fn(clock);
      await new Promise((r) => setImmediate(r));
    }
  };
  const players = () => db.prepare("select * from players").all() as { seq: number; arenas: number; xp: number }[];
  // click the class chip with this text (in the new-account form)
  const chip = (klass: string) => made.find((m) => m.textContent === klass)!.handlers.click();
  const accounts = () => db.prepare("select username, display_name, klass from accounts").all();
  return {
    el,
    tick,
    store,
    players,
    accounts,
    chip,
    log,
    win: { handlers: handlers as Record<string, (e: Event) => void> },
    cookie: () => cookie,
  };
}

(async () => {
  const env = await makeEnv();
  await env.tick(5);
  assert.strictEqual(env.players().length, 1, "got a player cookie");
  assert.match(env.cookie() ?? "", /^ff_player=/);
  assert.ok(env.log.includes("session"));

  // tap to start, then tap a few times, then do nothing until dead
  const tap = () =>
    env
      .el("frame")
      .handlers.pointerdown({
        isTrusted: true,
        target: { closest: () => null },
        preventDefault() {},
      });
  // the main menu is showing: tapping empty space must not start a hidden run
  tap();
  await env.tick(5);
  assert.ok(
    !env.log.includes("run-start"),
    "tap on the menu does not start a run",
  );
  // typing in the name field (Space/W/arrows) must not be swallowed or steer the game
  let prevented = false;
  env.win.handlers.keydown({
    isTrusted: true,
    code: "Space",
    target: { closest: (sel: string) => (/input/.test(sel) ? {} : null) },
    preventDefault() {
      prevented = true;
    },
  });
  assert.ok(!prevented, "keys typed in an input are left alone");
  await env.tick(2);
  assert.ok(!env.log.includes("run-start"), "typing does not start a run");
  env.el("modeNormal").handlers.click();
  await env.tick(2);
  // a bot's dispatchEvent / el.click() gives isTrusted === false: ignored
  env.el("frame").handlers.pointerdown({
    isTrusted: false,
    target: { closest: () => null },
    preventDefault() {},
  });
  env.win.handlers.keydown({
    isTrusted: false,
    code: "Space",
    target: { closest: () => null },
    preventDefault() {},
  });
  await env.tick(5);
  assert.ok(!env.log.includes("run-start"), "untrusted input does not start a run");
  tap();
  await env.tick(5);
  assert.ok(env.log.includes("run-start"), "run requested from server");
  assert.strictEqual(env.el("intro").hidden, true, "game started");
  for (let i = 0; i < 12; i++) {
    tap();
    await env.tick(14);
  }
  for (let i = 0; i < 600 && env.el("end").hidden !== false; i++)
    await env.tick(1);
  assert.strictEqual(env.el("end").hidden, false, "end screen shown");
  assert.ok(env.log.includes("run-finish"), "run sent to server for replay");
  assert.strictEqual(env.players()[0].seq, 1, "server stored the verified run");
  const shown = parseInt(env.el("endScore").textContent, 10);
  console.log(
    "score on screen:",
    shown,
    "| xp text:",
    env.el("endXp").textContent,
  );
  assert.ok(shown >= 0);

  // cheating via storage or a made-up cookie: nothing gained, a fresh player
  const env2 = await makeEnv({
    cookie: "ff_player=" + "x".repeat(43),
    storage: {
      "orneflukt-auth":
        '{"access_token":"forged","refresh_token":"x","expires_at":9999999999}',
      "orneflukt-xp": "200",
      "orneflukt-arenas": "10",
    },
  });
  await env2.tick(5);
  const [p2] = env2.players();
  assert.ok(p2, "forged cookie replaced by a new player");
  assert.strictEqual(p2.arenas, 1);
  assert.strictEqual(p2.xp, 0);
  assert.ok(!env2.store.has("orneflukt-xp"), "old unsigned keys removed");
  assert.ok(!env2.store.has("orneflukt-auth"), "old Supabase login removed");
  assert.notStrictEqual(env2.cookie(), "ff_player=" + "x".repeat(43));

  // no server: the game still starts and ends, but nothing is saved
  const env3 = await makeEnv({ offline: true });
  await env3.tick(5);
  env3.el("modeNormal").handlers.click();
  env3
    .el("frame")
    .handlers.pointerdown({
      isTrusted: true,
      target: { closest: () => null },
      preventDefault() {},
    });
  await env3.tick(5);
  assert.strictEqual(env3.el("intro").hidden, true, "offline game started");
  for (let i = 0; i < 600 && env3.el("end").hidden !== false; i++)
    await env3.tick(1);
  assert.strictEqual(env3.el("end").hidden, false);
  assert.ok(
    /Ikke lagret/.test(env3.el("endXp").textContent),
    env3.el("endXp").textContent,
  );
  assert.strictEqual(env3.players().length, 0);

  // competition needs an account: without one, the login form shows
  const env4 = await makeEnv();
  await env4.tick(5);
  const submit = (id: string) => env4.el(id).handlers.submit({ preventDefault() {} });
  env4.el("modeComp").handlers.click();
  await env4.tick(3);
  assert.strictEqual(env4.el("loginForm").hidden, false, "login form shown");
  assert.strictEqual(env4.el("compMe").hidden, true);
  // make an account: passwords that don't match are caught before sending
  env4.el("toRegister").handlers.click();
  assert.strictEqual(env4.el("registerForm").hidden, false, "new-account form shown");
  env4.el("regUser").value = "Ola.N";
  env4.el("regName").value = "Ola Nordmann";
  env4.el("regPass").value = "hemmelig";
  env4.el("regPass2").value = "hemmelig";
  submit("registerForm");
  assert.match(env4.el("regMsg").textContent, /klasse/i, "class must be chosen");
  env4.chip("2STA");
  env4.el("regPass2").value = "hemmelix";
  submit("registerForm");
  assert.match(env4.el("regMsg").textContent, /ikke like/);
  assert.ok(!env4.log.includes("account-register"), "nothing sent yet");
  env4.el("regPass2").value = "hemmelig";
  submit("registerForm");
  await env4.tick(3);
  assert.deepStrictEqual(env4.accounts(), [{ username: "ola.n", display_name: "Ola Nordmann", klass: "2STA" }]);
  assert.strictEqual(env4.el("compMe").hidden, false, "logged in after making the account");
  assert.strictEqual(env4.el("meName").textContent, "Ola Nordmann");
  assert.match(env4.el("meInfo").textContent, /2STA.*ola\.n/);
  assert.match(env4.cookie() ?? "", /ff_account=/);
  // start: the run goes to the server, and the score lands under the account
  env4.el("compGo").handlers.click();
  await env4.tick(8);
  assert.ok(env4.log.includes("run-start"), "competition run requested");
  assert.strictEqual(env4.el("intro").hidden, true, "competition game started");
  assert.strictEqual(env4.el("hudName").textContent, "Ola Nordmann · 2STA");
  // log out: back to the login form; logging in again works
  env4.el("toMenu").handlers.click();
  env4.el("modeComp").handlers.click();
  await env4.tick(3);
  assert.strictEqual(env4.el("compMe").hidden, false, "still logged in");
  env4.el("logoutBtn").handlers.click();
  await env4.tick(3);
  assert.strictEqual(env4.el("loginForm").hidden, false, "login form after logging out");
  assert.ok(!(env4.cookie() ?? "").includes("ff_account"));
  env4.el("loginUser").value = "ola.n";
  env4.el("loginPass").value = "feil-passord";
  submit("loginForm");
  await env4.tick(3);
  assert.match(env4.el("loginMsg").textContent, /Feil brukernavn eller passord/);
  env4.el("loginPass").value = "hemmelig";
  submit("loginForm");
  await env4.tick(3);
  assert.strictEqual(env4.el("compMe").hidden, false, "logged in again");

  // going back to the menu while a competition start is loading drops it
  const env5 = await makeEnv({ cookie: env4.cookie() ?? undefined });
  await env5.tick(5);
  env5.el("toRegister").handlers.click();
  env5.el("regUser").value = "kari";
  env5.el("regName").value = "Kari";
  env5.chip("1IM");
  env5.el("regPass").value = env5.el("regPass2").value = "hemmelig";
  env5.el("registerForm").handlers.submit({ preventDefault() {} });
  await env5.tick(3);
  env5.el("compGo").handlers.click();
  env5.el("formBack").handlers.click(); // back to the menu before the server answers
  await env5.tick(8);
  assert.ok(!env5.log.includes("run-start"), "no run after leaving the form");
  assert.strictEqual(env5.el("menu").hidden, false, "menu still showing");

  console.log("\nclient smoke test OK");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
