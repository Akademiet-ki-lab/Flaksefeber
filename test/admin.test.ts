// Tests the /api/admin handler against an in-memory SQLite database.
import assert from "node:assert";
import { openDb } from "../lib/server/db";
import { handleAdmin, addAdmin, removeAdmin } from "../lib/server/admin";
import { handleGame } from "../lib/server/game";
import { resetLimits } from "../lib/server/http";
import type { DB } from "../lib/server/db";

type Opts = {
  cookie?: string | null;
  origin?: string;
  type?: string | null;
  handler?: (db: DB, req: Request) => Promise<Response>;
};
// the parts of a reply the tests look at
type Reply = { status: number; data: any; setCookie: string | null; cookie: string | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

const db = openDb(":memory:");
let n = 0;
const t = async (name: string, fn: () => unknown) => {
  await fn();
  n++;
  console.log("ok  " + name);
};

async function call(
  body: object,
  { cookie, origin, type = "application/json", handler = handleAdmin }: Opts = {},
): Promise<Reply> {
  const headers: Record<string, string> = { host: "spill.no" };
  if (type) headers["content-type"] = type;
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  const res = await handler(
    db,
    new Request("http://spill.no/api/admin", { method: "POST", headers, body: JSON.stringify(body) }),
  );
  const set = res.headers.getSetCookie();
  return {
    status: res.status,
    data: await res.json(),
    setCookie: res.headers.get("set-cookie"),
    // every cookie the reply set (a game reply can set both ff_player and ff_account)
    cookie: set.length ? set.map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ") || null : null,
  };
}
const PW = "riktig-hest-batteri";
const login = (username = "laerer1", password = PW) => call({ action: "login", username, password });

let admin: string | null = null;
await t("admin users are only added from the command line, with a strong password", async () => {
  assert.throws(() => addAdmin(db, "laerer1", "kort"), /minst 10/);
  assert.throws(() => addAdmin(db, "x", PW), /Ugyldig/);
  assert.strictEqual(addAdmin(db, "Laerer1", PW), "laerer1");
  const row = db.prepare("select * from admins").get() as { pass_hash: string };
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
  assert.match(r.setCookie ?? "", /^ff_admin=[A-Za-z0-9_-]{43}; /);
  assert.match(r.setCookie ?? "", /HttpOnly/);
  assert.match(r.setCookie ?? "", /SameSite=Strict/);
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
    { id: 0, name: "Kari", klass: "2STA", score: 57, hidden: false, account: null, achievedAt: 0 },
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
  assert.deepStrictEqual(pub.data.rows.map((r: { name: string; score: number }) => [r.name, r.score]), [["Kari N", 80]]);

  await call({ action: "update", id: rowId, hidden: true }, { cookie: admin });
  const hid = await call({ action: "leaderboard" }, { handler: handleGame });
  assert.strictEqual(hid.data.rows.length, 0, "hidden rows are not public");
  const list = await call({ action: "list" }, { cookie: admin });
  assert.strictEqual(list.data.rows.length, 1, "admins still see hidden rows");

  assert.strictEqual((await call({ action: "delete", id: rowId }, { cookie: admin })).status, 200);
  assert.strictEqual((await call({ action: "delete", id: rowId }, { cookie: admin })).status, 404);
  assert.strictEqual((await call({ action: "update", id: rowId, score: 1 }, { cookie: admin })).status, 404);
  const logged = db.prepare("select action from admin_log where username = 'laerer1'").all().map((r) => (r as { action: string }).action);
  assert.deepStrictEqual(logged, ["login", "add", "update", "update", "delete"]);
});

await t("logout ends the session, and a new password ends all sessions", async () => {
  const out = await call({ action: "logout" }, { cookie: admin });
  assert.match(out.setCookie ?? "", /Max-Age=0/);
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

await t("admins manage player accounts: password, name/class, delete", async () => {
  resetLimits();
  const a = (await login("laerer3")).cookie;
  const game = (body: object, cookie?: string | null) => call(body, { handler: handleGame, cookie });
  // a player makes an account and gets on the leaderboard
  const reg = await game({ action: "account-register", username: "kari", displayName: "Kari", klass: "2STA", password: "hemmelig" });
  assert.strictEqual(reg.status, 200);
  assert.match(reg.cookie ?? "", /ff_player=.*ff_account=|ff_account=.*ff_player=/, "logged in after registering");
  assert.ok((await game({ action: "session" }, reg.cookie)).data.account, "the login works before the password change");
  const accId = (db.prepare("select id from accounts where username = 'kari'").get() as { id: number }).id;
  db.prepare(
    "insert into leaderboard (account_id, name, klass, best, achieved_at, updated_at) values (?, 'Kari', '2STA', 40, 1, 1)",
  ).run(accId);

  const list = await call({ action: "accounts" }, { cookie: a });
  const kari = list.data.accounts.find((x: { username: string }) => x.username === "kari");
  assert.deepStrictEqual(
    { ...kari, createdAt: 0 },
    { id: accId, username: "kari", displayName: "Kari", klass: "2STA", createdAt: 0, best: 40 },
  );
  assert.ok(!JSON.stringify(list.data).includes("scrypt"), "password hashes never leave the server");

  // new password: too short is refused; the old one stops working; the player is logged out
  assert.strictEqual((await call({ action: "account-update", id: accId, password: "12345" }, { cookie: a })).status, 400);
  const up = await call({ action: "account-update", id: accId, password: "nytt-passord", displayName: "Kari N", klass: "3STA" }, { cookie: a });
  assert.strictEqual(up.status, 200, JSON.stringify(up.data));
  assert.strictEqual((await game({ action: "session" }, reg.cookie)).data.account, null, "logged out everywhere");
  assert.strictEqual((await game({ action: "account-login", username: "kari", password: "hemmelig" })).status, 401);
  assert.strictEqual((await game({ action: "account-login", username: "kari", password: "nytt-passord" })).status, 200);
  // the leaderboard follows the account's new name and class
  const lb = await game({ action: "leaderboard" });
  assert.ok(lb.data.rows.some((r: { name: string; klass: string }) => r.name === "Kari N" && r.klass === "3STA"));
  const logged = db.prepare("select details from admin_log where action = 'account-update'").get() as { details: string };
  assert.ok(!logged.details.includes("nytt-passord"), "the password is never logged");

  // players can't change passwords themselves: there is no such action
  assert.strictEqual((await game({ action: "account-password", password: "x" }, reg.cookie)).status, 404);

  // deleting removes the account and its leaderboard row
  assert.strictEqual((await call({ action: "account-delete", id: accId }, { cookie: a })).status, 200);
  assert.strictEqual((await call({ action: "account-delete", id: accId }, { cookie: a })).status, 404);
  assert.strictEqual(
    (db.prepare("select count(*) as n from leaderboard where account_id = ?").get(accId) as { n: number }).n,
    0,
  );
  // and none of this works without an admin login
  assert.strictEqual((await call({ action: "accounts" })).status, 401);
});

console.log("\n" + n + " admin-tester OK");
