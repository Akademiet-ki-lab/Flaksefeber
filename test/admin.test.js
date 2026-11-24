// Tests the /api/admin handler against an in-memory SQLite database.
import assert from "node:assert";
import { openDb } from "../lib/server/db.js";
import { handleAdmin, addAdmin, removeAdmin } from "../lib/server/admin.js";
import { handleGame } from "../lib/server/game.js";
import { resetLimits } from "../lib/server/http.js";

const db = openDb(":memory:");
let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log("ok  " + name);
};

async function call(body, { cookie, origin, type = "application/json", handler = handleAdmin } = {}) {
  const headers = { host: "spill.no" };
  if (type) headers["content-type"] = type;
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await handler(
    db,
    new Request("http://spill.no/api/admin", { method: "POST", headers, body: JSON.stringify(body) }),
  );
  const set = res.headers.get("set-cookie");
  return { status: res.status, data: await res.json(), setCookie: set, cookie: set ? set.split(";")[0] : null };
}
const PW = "riktig-hest-batteri";
const login = (username = "laerer1", password = PW) => call({ action: "login", username, password });

let admin;
await t("admin users are only added from the command line, with a strong password", async () => {
  assert.throws(() => addAdmin(db, "laerer1", "kort"), /minst 10/);
  assert.throws(() => addAdmin(db, "x", PW), /Ugyldig/);
  assert.strictEqual(addAdmin(db, "Laerer1", PW), "laerer1");
  const row = db.prepare("select * from admins").get();
  assert.ok(row.pass_hash.startsWith("scrypt$") && !row.pass_hash.includes(PW));
});

await t("everything but login needs a session", async () => {
  for (const action of ["me", "list", "add", "update", "delete"])
    assert.strictEqual((await call({ action })).status, 401, action);
});

await t("wrong username or password is refused the same way", async () => {
  const a = await login("laerer1", "feil-passord-123");
  const b = await login("finnesikke", PW);
  assert.strictEqual(a.status, 401);
  assert.strictEqual(b.status, 401);
  assert.deepStrictEqual(a.data, b.data);
  assert.strictEqual(a.setCookie, null);
});

await t("right login gives a strict httpOnly cookie (username is case-insensitive)", async () => {
  const r = await login("LAERER1");
  assert.strictEqual(r.status, 200);
  assert.match(r.setCookie, /^ff_admin=[A-Za-z0-9_-]{43}; /);
  assert.match(r.setCookie, /HttpOnly/);
  assert.match(r.setCookie, /SameSite=Strict/);
  admin = r.cookie;
  assert.strictEqual((await call({ action: "me" }, { cookie: admin })).data.username, "laerer1");
});

await t("cross-site requests and non-JSON bodies are refused", async () => {
  assert.strictEqual((await call({ action: "list" }, { cookie: admin, origin: "https://evil.example" })).status, 403);
  assert.strictEqual((await call({ action: "list" }, { cookie: admin, type: "text/plain" })).status, 415);
});

let rowId;
await t("add, change and delete leaderboard rows", async () => {
  const add = await call({ action: "add", name: "Kari", klass: "2STA", score: 57 }, { cookie: admin });
  assert.strictEqual(add.status, 200, JSON.stringify(add.data));
  assert.deepStrictEqual(
    { ...add.data.row, id: 0, achievedAt: 0 },
    { id: 0, name: "Kari", klass: "2STA", score: 57, hidden: false, player: false, achievedAt: 0 },
  );
  rowId = add.data.row.id;
  for (const bad of [
    { name: "", klass: "2STA", score: 1 },
    { name: "A", klass: "9ZZ", score: 1 },
    { name: "A", klass: "2STA", score: -1 },
    { name: "A", klass: "2STA", score: 1.5 },
    { name: "A", klass: "2STA", score: "12" },
  ])
    assert.strictEqual((await call({ action: "add", ...bad }, { cookie: admin })).status, 400, JSON.stringify(bad));

  const up = await call({ action: "update", id: rowId, score: 80, name: "Kari N" }, { cookie: admin });
  assert.strictEqual(up.data.row.score, 80);
  assert.strictEqual(up.data.row.name, "Kari N");
  assert.strictEqual(up.data.row.klass, "2STA");

  // the public leaderboard shows the change
  const pub = await call({ action: "leaderboard" }, { handler: handleGame });
  assert.deepStrictEqual(pub.data.rows.map((r) => [r.name, r.score]), [["Kari N", 80]]);

  await call({ action: "update", id: rowId, hidden: true }, { cookie: admin });
  const hid = await call({ action: "leaderboard" }, { handler: handleGame });
  assert.strictEqual(hid.data.rows.length, 0, "hidden rows are not public");
  const list = await call({ action: "list" }, { cookie: admin });
  assert.strictEqual(list.data.rows.length, 1, "admins still see hidden rows");

  assert.strictEqual((await call({ action: "delete", id: rowId }, { cookie: admin })).status, 200);
  assert.strictEqual((await call({ action: "delete", id: rowId }, { cookie: admin })).status, 404);
  assert.strictEqual((await call({ action: "update", id: rowId, score: 1 }, { cookie: admin })).status, 404);
  const logged = db.prepare("select action from admin_log where username = 'laerer1'").all().map((r) => r.action);
  assert.deepStrictEqual(logged, ["login", "add", "update", "update", "delete"]);
});

await t("logout ends the session, and a new password ends all sessions", async () => {
  const out = await call({ action: "logout" }, { cookie: admin });
  assert.match(out.setCookie, /Max-Age=0/);
  assert.strictEqual((await call({ action: "me" }, { cookie: admin })).status, 401);
  const again = (await login()).cookie;
  addAdmin(db, "laerer1", "et-helt-nytt-passord");
  assert.strictEqual((await call({ action: "me" }, { cookie: again })).status, 401);
  assert.strictEqual((await login()).status, 401, "old password no longer works");
});

await t("expired sessions and removed users can't do anything", async () => {
  addAdmin(db, "laerer2", PW);
  const c = (await login("laerer2")).cookie;
  db.prepare("update admin_sessions set expires_at = ?").run(Date.now() - 1);
  assert.strictEqual((await call({ action: "list" }, { cookie: c })).status, 401);
  const c2 = (await login("laerer2")).cookie;
  removeAdmin(db, "laerer2");
  assert.strictEqual((await call({ action: "list" }, { cookie: c2 })).status, 401);
});

await t("too many wrong passwords locks the login for a while", async () => {
  resetLimits();
  addAdmin(db, "laerer3", PW);
  for (let i = 0; i < 8; i++) assert.strictEqual((await login("laerer3", "feil-feil-feil")).status, 401);
  assert.strictEqual((await login("laerer3")).status, 429, "even the right password waits");
  resetLimits();
  assert.strictEqual((await login("laerer3")).status, 200);
});

console.log("\n" + n + " admin-tester OK");
