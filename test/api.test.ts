// Tests the real /api/game handler against an in-memory SQLite database.
import assert from "node:assert";
import Sim from "../lib/game/sim";
import { openDb } from "../lib/server/db";
import { handleGame } from "../lib/server/game";
import { resetLimits } from "../lib/server/http";

// the parts of a reply the tests look at
type Reply = { status: number; data: any; setCookie: string | null; cookie: string | null | undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any

const db = openDb(":memory:");
let n = 0;
const t = async (name: string, fn: () => unknown) => {
  await fn();
  n++;
  console.log("ok  " + name);
};

async function call(
  body: object,
  { cookie, origin, host = "spill.no" }: { cookie?: string | null; origin?: string; host?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { "Content-Type": "application/json", host };
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await handleGame(
    db,
    new Request("http://" + host + "/api/game", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  return {
    status: res.status,
    data: await res.json(),
    setCookie: res.headers.get("set-cookie"),
    cookie: mergeCookies(cookie, res.headers.getSetCookie()),
  };
}

// the browser's cookie jar after a reply: new cookies added, cleared ones removed
function mergeCookies(cookie: string | null | undefined, set: string[]): string | null {
  const jar = new Map<string, string>();
  for (const part of (cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  for (const c of set) {
    const kv = c.split(";")[0];
    const i = kv.indexOf("=");
    const [k, v] = [kv.slice(0, i), kv.slice(i + 1)];
    if (v) jar.set(k, v);
    else jar.delete(k);
  }
  return jar.size ? [...jar].map(([k, v]) => k + "=" + v).join("; ") : null;
}

// simple bot: aims low in the next opening
function play(seed: number, comp?: boolean) {
  const s = Sim.create(seed, comp);
  const inputs: number[] = [];
  while (s.status === "play" && s.frame < 20000) {
    const nx = s.trees.find((x) => x.x > 110 - 75);
    const flap = s.y > (nx ? nx.gapBottom - 20 : 290);
    if (flap) inputs.push(s.frame);
    Sim.step(s, flap);
  }
  return { inputs, frames: s.frame, score: s.score };
}
// pretend the run started long ago, so it passes the real-time check
const age = (runId: string) =>
  db.prepare("update runs set started_at = ? where id = ?").run(Date.now() - 20 * 60_000, runId);

let me: string | null | undefined;
await t("a new visitor gets an httpOnly cookie and fresh progress", async () => {
  const r = await call({ action: "session" });
  assert.strictEqual(r.status, 200);
  assert.match(r.setCookie ?? "", /^ff_player=[A-Za-z0-9_-]{43}; /);
  assert.match(r.setCookie ?? "", /HttpOnly/);
  assert.match(r.setCookie ?? "", /SameSite=Lax/);
  assert.deepStrictEqual(r.data.progress, {
    bests: Array(10).fill(0),
    arenas: 1,
    arena: 0,
    xp: 0,
    skin: 0,
  });
  me = r.cookie;
  const again = await call({ action: "session" }, { cookie: me });
  assert.strictEqual(again.setCookie, null, "known player keeps the cookie");
  const raw = me!.split("=")[1];
  assert.strictEqual(
    (db.prepare("select count(*) as n from players where id = ?").get(raw) as { n: number }).n,
    0,
    "the raw token is not stored",
  );
});

await t("a forged cookie just gives a new, empty player", async () => {
  const r = await call({ action: "session" }, { cookie: "ff_player=" + "A".repeat(43) });
  assert.ok(r.setCookie);
  assert.strictEqual(r.data.progress.xp, 0);
});

await t("requests from another site are refused", async () => {
  const r = await call({ action: "session" }, { cookie: me, origin: "https://evil.example" });
  assert.strictEqual(r.status, 403);
  const ok = await call({ action: "session" }, { cookie: me, origin: "http://spill.no" });
  assert.strictEqual(ok.status, 200);
});

await t("a normal run is replayed and saved once", async () => {
  const start = await call({ action: "run-start", arena: 0 }, { cookie: me });
  assert.strictEqual(start.status, 200);
  const g = play(start.data.seed);
  // too fast: finished right after starting
  const fast = await call(
    { action: "run-finish", runId: start.data.runId, inputs: g.inputs, frames: g.frames },
    { cookie: me },
  );
  if (g.frames > 400) assert.strictEqual(fast.status, 400);
  age(start.data.runId);
  const fin = await call(
    { action: "run-finish", runId: start.data.runId, inputs: g.inputs, frames: g.frames },
    { cookie: me },
  );
  assert.strictEqual(fin.status, 200, JSON.stringify(fin.data));
  assert.strictEqual(fin.data.result.score, g.score);
  assert.strictEqual(fin.data.progress.bests[0], g.score);
  const twice = await call(
    { action: "run-finish", runId: start.data.runId, inputs: g.inputs, frames: g.frames },
    { cookie: me },
  );
  assert.strictEqual(twice.status, 409, "a run counts only once");
});

await t("someone else's run id can't be used", async () => {
  const other = await call({ action: "session" });
  const start = await call({ action: "run-start", arena: 0 }, { cookie: me });
  const r = await call(
    { action: "run-finish", runId: start.data.runId, inputs: [], frames: 10 },
    { cookie: other.cookie },
  );
  assert.strictEqual(r.status, 409);
});

await t("locked arenas and skins are refused", async () => {
  assert.strictEqual((await call({ action: "run-start", arena: 3 }, { cookie: me })).status, 400);
  assert.strictEqual((await call({ action: "select", arena: 0, skin: 6 }, { cookie: me })).status, 400);
  assert.strictEqual((await call({ action: "select", arena: 0, skin: 0 }, { cookie: me })).status, 200);
});

await t("competition mode needs an account; normal mode doesn't", async () => {
  const r = await call({ action: "run-start", mode: "comp" }, { cookie: me });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.data.error, "login_required");
  assert.strictEqual((await call({ action: "run-start", arena: 0 }, { cookie: me })).status, 200);
  assert.strictEqual((await call({ action: "session" }, { cookie: me })).data.account, null);
});

await t("making an account: unique username, display name, class, password of 6+", async () => {
  const reg = (b: object) => call({ action: "account-register", ...b }, { cookie: me });
  const ok = { username: "Ola.N", displayName: "Ola <b>", klass: "1IM", password: "hemmelig" };
  assert.strictEqual((await reg({ ...ok, password: "12345" })).data.error, "bad_password");
  assert.strictEqual((await reg({ ...ok, username: "x" })).data.error, "bad_username");
  assert.strictEqual((await reg({ ...ok, username: "ola nordmann" })).data.error, "bad_username");
  assert.strictEqual((await reg({ ...ok, displayName: "  " })).data.error, "bad_name");
  assert.strictEqual((await reg({ ...ok, klass: "9ZZ" })).data.error, "bad_klass");
  const r = await reg(ok);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.deepStrictEqual(r.data.account, { username: "ola.n", displayName: "Ola b", klass: "1IM" });
  assert.match(r.setCookie ?? "", /ff_account=[A-Za-z0-9_-]{43}; .*HttpOnly/);
  const taken = await call({ action: "account-register", ...ok, username: "OLA.n" });
  assert.strictEqual(taken.status, 409, "usernames are unique, whatever the case");
  me = r.cookie;
  const s = await call({ action: "session" }, { cookie: me });
  assert.deepStrictEqual(s.data.account, { username: "ola.n", displayName: "Ola b", klass: "1IM" });
  const row = db.prepare("select pass_hash from accounts").get() as { pass_hash: string };
  assert.ok(row.pass_hash.startsWith("scrypt$") && !row.pass_hash.includes("hemmelig"));
});

await t("competition runs go on the leaderboard under the account", async () => {
  const start = await call({ action: "run-start", mode: "comp" }, { cookie: me });
  assert.strictEqual(start.status, 200);
  const g = play(start.data.seed, true);
  age(start.data.runId);
  // name and class come from the account, whatever the browser sends
  const fin = await call(
    { action: "run-finish", runId: start.data.runId, inputs: g.inputs, frames: g.frames, name: "Juks", klass: "2IM" },
    { cookie: me },
  );
  assert.strictEqual(fin.status, 200, JSON.stringify(fin.data));
  assert.strictEqual(fin.data.result.score, g.score);
  if (g.score > 0) {
    const lb = await call({ action: "leaderboard" }, { cookie: me });
    assert.deepStrictEqual(
      { name: lb.data.rows[0].name, klass: lb.data.rows[0].klass, me: lb.data.rows[0].me },
      { name: "Ola b", klass: "1IM", me: true },
    );
    assert.strictEqual(lb.data.me.rank, 1);
    // another browser (no cookies) logs in to the same account and sees the same best
    const other = await call({ action: "account-login", username: "OLA.N", password: "hemmelig" });
    assert.strictEqual(other.status, 200);
    const lb2 = await call({ action: "leaderboard" }, { cookie: other.cookie });
    assert.strictEqual(lb2.data.me.best, g.score);
    db.prepare("update leaderboard set hidden = 1").run();
    const hid = await call({ action: "leaderboard" }, { cookie: me });
    assert.strictEqual(hid.data.rows.length, 0, "hidden rows are not shown");
    assert.strictEqual(hid.data.me.rank, null);
    db.prepare("update leaderboard set hidden = 0").run();
  }
});

await t("logging in and out", async () => {
  const wrong = await call({ action: "account-login", username: "ola.n", password: "feil-passord" });
  const nobody = await call({ action: "account-login", username: "finnesikke", password: "hemmelig" });
  assert.strictEqual(wrong.status, 401);
  assert.deepStrictEqual(wrong.data, nobody.data, "same answer for wrong user and wrong password");
  const out = await call({ action: "account-logout" }, { cookie: me });
  assert.match(out.setCookie ?? "", /ff_account=; .*Max-Age=0/);
  assert.ok(!(out.cookie ?? "").includes("ff_account"));
  assert.strictEqual((await call({ action: "run-start", mode: "comp" }, { cookie: me })).status, 401);
  // the old login token no longer works, even if someone kept it
  const s = await call({ action: "session" }, { cookie: me });
  assert.strictEqual(s.data.account, null);
  const back = await call({ action: "account-login", username: "ola.n", password: "hemmelig" }, { cookie: out.cookie });
  assert.strictEqual(back.status, 200);
  me = back.cookie;
});

await t("too many wrong passwords for one user locks that user for a while", async () => {
  resetLimits();
  for (let i = 0; i < 8; i++)
    assert.strictEqual((await call({ action: "account-login", username: "ola.n", password: "feilfeil" })).status, 401);
  assert.strictEqual((await call({ action: "account-login", username: "ola.n", password: "hemmelig" })).status, 429);
});

await t("garbage requests are refused", async () => {
  const res = await handleGame(
    db,
    new Request("http://spill.no/api/game", { method: "POST", body: "not json" }),
  );
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await call({ action: "nope" }, { cookie: me })).status, 404);
  assert.strictEqual((await call({ action: "run-finish", runId: 5 }, { cookie: me })).status, 400);
});

console.log("\n" + n + " API-tester OK");
