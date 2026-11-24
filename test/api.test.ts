// Tests the real /api/game handler against an in-memory SQLite database.
import assert from "node:assert";
import Sim from "../lib/game/sim";
import { openDb } from "../lib/server/db";
import { handleGame } from "../lib/server/game";

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
  const set = res.headers.get("set-cookie");
  return {
    status: res.status,
    data: await res.json(),
    setCookie: set,
    cookie: set ? set.split(";")[0] : cookie,
  };
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

await t("competition runs go on the leaderboard", async () => {
  const start = await call({ action: "run-start", mode: "comp" }, { cookie: me });
  const g = play(start.data.seed, true);
  age(start.data.runId);
  const bad = await call(
    { action: "run-finish", runId: start.data.runId, inputs: g.inputs, frames: g.frames, name: "", klass: "1IM" },
    { cookie: me },
  );
  assert.strictEqual(bad.status, 400);
  const fin = await call(
    { action: "run-finish", runId: start.data.runId, inputs: g.inputs, frames: g.frames, name: "Ola <b>", klass: "1IM" },
    { cookie: me },
  );
  assert.strictEqual(fin.status, 200, JSON.stringify(fin.data));
  assert.strictEqual(fin.data.result.score, g.score);
  if (g.score > 0) {
    const lb = await call({ action: "leaderboard" }, { cookie: me });
    assert.strictEqual(lb.data.rows[0].name, "Ola b");
    assert.ok(lb.data.rows[0].me);
    assert.strictEqual(lb.data.me.rank, 1);
    db.prepare("update leaderboard set hidden = 1").run();
    const hid = await call({ action: "leaderboard" }, { cookie: me });
    assert.strictEqual(hid.data.rows.length, 0, "hidden rows are not shown");
    assert.strictEqual(hid.data.me.rank, null);
  }
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
