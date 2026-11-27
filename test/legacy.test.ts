// The old leaderboard (from the Supabase version) is copied in once and can never change.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, legacyLeaderboard, allTimeLeaderboard, weekStart, rollWeek } from "../lib/server/db";
import legacy from "../lib/server/legacy-leaderboard.json";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("ok  " + name);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-legacy-"));
const file = path.join(dir, "test.db");

t("the old leaderboard is filled from the JSON file, in order", () => {
  const rows = legacyLeaderboard(openDb(file));
  assert.strictEqual(rows.length, legacy.rows.length);
  assert.deepStrictEqual(rows, legacy.rows);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].rank > rows[i - 1].rank);
});

t("nothing can insert, change or delete rows", () => {
  const db = openDb(file);
  for (const sql of [
    "insert into legacy_leaderboard (rank, name, klass, score) values (9999, 'Juks', '1IM', 9999)",
    "update legacy_leaderboard set score = 9999 where rank = 1",
    "update legacy_leaderboard set name = 'Juks'",
    "delete from legacy_leaderboard where rank = 1",
    "delete from legacy_leaderboard",
  ])
    assert.throws(() => db.exec(sql), /skrivebeskyttet/, sql);
  assert.deepStrictEqual(legacyLeaderboard(db), legacy.rows);
});

t("opening the database again doesn't add the rows twice", () => {
  openDb(file).close();
  assert.strictEqual(legacyLeaderboard(openDb(file)).length, legacy.rows.length);
});

t("switching to accounts clears the leaderboard once, and keeps everything else", () => {
  // a database as it was before accounts: leaderboard rows belong to browsers
  const old = path.join(dir, "before-accounts.db");
  const raw = new Database(old);
  raw.exec(`
    create table players (id text primary key, bests text not null, arenas integer not null default 1,
      arena integer not null default 0, xp integer not null default 0, skin integer not null default 0,
      seq integer not null default 0, created_at integer not null, updated_at integer not null);
    create table runs (id text primary key, player_id text not null, seed integer not null, seq integer not null,
      arena integer not null, mode text not null default 'normal', started_at integer not null,
      finished integer not null default 0);
    create table leaderboard (id integer primary key autoincrement, player_id text unique, name text not null,
      klass text not null, best integer not null default 0, achieved_at integer not null,
      updated_at integer not null, hidden integer not null default 0);
    insert into players values ('p1', '[5,0,0,0,0,0,0,0,0,0]', 1, 0, 3, 0, 4, 1, 1);
    insert into runs (id, player_id, seed, seq, arena, started_at) values ('r1', 'p1', 1, 0, 0, 1);
    insert into leaderboard (player_id, name, klass, best, achieved_at, updated_at) values ('p1', 'Ola', '1IM', 77, 1, 1);
    insert into leaderboard (player_id, name, klass, best, achieved_at, updated_at) values (null, 'Admin', '2IM', 50, 1, 1);
  `);
  raw.close();

  const db = openDb(old);
  const count = (table: string) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  assert.strictEqual(count("leaderboard"), 0, "the leaderboard is cleared");
  assert.strictEqual(count("players"), 1, "normal-mode progress is kept");
  assert.strictEqual((db.prepare("select xp from players").get() as { xp: number }).xp, 3);
  assert.strictEqual(count("runs"), 1);
  assert.deepStrictEqual(legacyLeaderboard(db), legacy.rows, "the old leaderboard stays");
  const cols = (table: string) => (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols("leaderboard").includes("account_id"));
  assert.ok(cols("runs").includes("account_id"));
  db.close();

  // a new score after the switch is not cleared the next time the server starts
  const again = openDb(old);
  again.prepare("insert into leaderboard (account_id, name, klass, best, achieved_at, updated_at) values (null, 'Ny', '1IM', 9, 1, 1)").run();
  again.close();
  const third = openDb(old);
  assert.strictEqual((third.prepare("select count(*) as n from leaderboard").get() as { n: number }).n, 1);
  third.close();
});

t("the all-time leaderboard has the old and the current results, one best score per person", () => {
  const db = openDb(path.join(dir, "all-time.db"));
  const key = (r: { name: string; klass: string }) => r.name.toLowerCase() + "|" + r.klass.toLowerCase();

  // no competition results yet: the old list, with only the best row per person
  const best = new Map<string, (typeof legacy.rows)[number]>();
  for (const r of legacy.rows) if (!best.has(key(r)) || r.score > best.get(key(r))!.score) best.set(key(r), r);
  const before = allTimeLeaderboard(db);
  assert.deepStrictEqual(
    before.map((r) => [r.name, r.klass, r.score]),
    [...best.values()].map((r) => [r.name, r.klass, r.score]),
  );
  assert.ok(before.length < legacy.rows.length, "the old list has people twice");

  const top = legacy.rows[0];
  const add = db.prepare(
    "insert into leaderboard (account_id, name, klass, best, achieved_at, updated_at, hidden) values (null, ?, ?, ?, ?, 1, ?)",
  );
  add.run("Ny best", "1IM", top.score + 10, 1, 0);
  add.run(top.name, top.klass, top.score - 5, 2, 0); // same person as the top old row, lower score
  add.run("Skjult", "1IM", 999, 3, 1);
  add.run("Null", "1IM", 0, 4, 0);
  add.run("Tvilling", "3STA", 80, 5, 0); // two accounts with the same name and class
  add.run("Tvilling", "3STA", 70, 6, 0);

  const all = allTimeLeaderboard(db);
  assert.deepStrictEqual(all[0], { rank: 1, name: "Ny best", klass: "1IM", score: top.score + 10 });
  const mine = all.filter((r) => key(r) === key(top));
  assert.strictEqual(mine.length, 1, "the old and the current result are one person");
  assert.strictEqual(mine[0].score, top.score, "the best of the two is kept");
  assert.strictEqual(all[1].name, top.name);
  assert.ok(!all.some((r) => r.name === "Skjult" || r.name === "Null"), "hidden and zero-score rows are left out");
  assert.deepStrictEqual(
    all.filter((r) => r.name === "Tvilling").map((r) => r.score),
    [80, 70],
    "two accounts are never merged",
  );
  all.forEach((r, i) => assert.strictEqual(r.rank, i + 1));
  for (let i = 1; i < all.length; i++) assert.ok(all[i].score <= all[i - 1].score);

  // an old result that beats the competition row of the same person wins
  const other = legacy.rows[5];
  add.run(other.name, other.klass, 5, 7, 0);
  const found = allTimeLeaderboard(db).filter((r) => key(r) === key(other));
  assert.deepStrictEqual(found.map((r) => r.score), [other.score]);

  // two accounts with the same name and class: the old result can't be tied to one of them
  const third = legacy.rows[8];
  add.run(third.name, third.klass, 1, 8, 0);
  add.run(third.name, third.klass, 2, 9, 0);
  const several = allTimeLeaderboard(db).filter((r) => key(r) === key(third));
  assert.deepStrictEqual(several.map((r) => r.score).sort((x, y) => y - x), [third.score, 2, 1]);

  assert.deepStrictEqual(legacyLeaderboard(db), legacy.rows, "the old list itself is untouched");
  assert.strictEqual((db.prepare("select count(*) as n from leaderboard").get() as { n: number }).n, 9, "the competition leaderboard keeps its rows");
  db.close();
});

t("a week starts on Monday 00:00 Oslo time, in winter and in summer", () => {
  assert.strictEqual(weekStart(Date.parse("2026-11-29T23:00:00Z")), "2026-11-30"); // Monday 00:00 CET
  assert.strictEqual(weekStart(Date.parse("2026-11-29T22:59:59Z")), "2026-11-23"); // Sunday 23:59:59
  assert.strictEqual(weekStart(Date.parse("2026-05-31T22:00:00Z")), "2026-06-01"); // Monday 00:00 CEST
  assert.strictEqual(weekStart(Date.parse("2026-05-31T21:59:59Z")), "2026-05-25");
  assert.strictEqual(weekStart(Date.parse("2026-12-02T12:00:00Z")), "2026-11-30"); // Wednesday
  assert.strictEqual(weekStart(Date.parse("2026-12-06T12:00:00Z")), "2026-11-30"); // Sunday
  assert.strictEqual(weekStart(Date.parse("2027-01-01T12:00:00Z")), "2026-12-28"); // across the new year
});

t("the leaderboard is emptied every Monday, and the results live on in the all-time list", () => {
  const db = openDb(path.join(dir, "weekly.db"));
  const count = (table: string) => (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  const at = (iso: string) => Date.parse(iso);
  const acct = db.prepare("insert into accounts (username, display_name, klass, pass_hash, created_at, updated_at) values (?, ?, ?, 'x', 1, 1)");
  const a1 = Number(acct.run("ola", "Ola", "1IM").lastInsertRowid);
  const a2 = Number(acct.run("kari", "Kari", "2IM").lastInsertRowid);
  const add = db.prepare(
    "insert into leaderboard (account_id, name, klass, best, achieved_at, updated_at, hidden) values (?, ?, ?, ?, ?, 1, ?)",
  );
  add.run(a1, "Ola", "1IM", 500, 10, 0);
  add.run(a2, "Kari", "2IM", 400, 20, 0);
  add.run(null, "Fra admin", "1IM", 300, 30, 0);
  add.run(null, "Skjult", "1IM", 900, 40, 1);

  // the first time it only notes the week; nothing is emptied
  assert.strictEqual(rollWeek(db, at("2026-12-02T12:00:00Z")), false);
  assert.strictEqual(count("leaderboard"), 4);
  assert.strictEqual(count("leaderboard_history"), 0);
  // later the same week: nothing happens
  assert.strictEqual(rollWeek(db, at("2026-12-06T22:00:00Z")), false);
  assert.strictEqual(count("leaderboard"), 4);

  // Monday 00:00: the week's results are archived, and the leaderboard is empty
  assert.strictEqual(rollWeek(db, at("2026-12-06T23:00:00Z")), true);
  assert.strictEqual(count("leaderboard"), 0);
  assert.strictEqual(count("leaderboard_history"), 4);
  assert.deepStrictEqual(
    (db.prepare("select distinct week from leaderboard_history").all() as { week: string }[]).map((r) => r.week),
    ["2026-11-30"],
  );
  assert.strictEqual(rollWeek(db, at("2026-12-07T10:00:00Z")), false, "only once per week");
  assert.strictEqual(count("leaderboard_history"), 4);

  // last week's results are still on the all-time list (hidden ones are not)
  const names = () => allTimeLeaderboard(db).filter((r) => ["Ola", "Ola B", "Kari", "Fra admin", "Skjult"].includes(r.name));
  assert.deepStrictEqual(names().map((r) => [r.name, r.score]), [["Ola", 500], ["Kari", 400], ["Fra admin", 300]]);

  // a new week: the same account is the same person (best score, newest name and class)
  add.run(a1, "Ola B", "2IM", 450, 50, 0);
  add.run(a2, "Kari", "2IM", 450, 51, 0);
  assert.deepStrictEqual(names().map((r) => [r.name, r.klass, r.score]), [
    ["Ola B", "2IM", 500],
    ["Kari", "2IM", 450],
    ["Fra admin", "1IM", 300],
  ]);

  // a week without a visit in between is also archived, with the week it belongs to
  assert.strictEqual(rollWeek(db, at("2027-01-20T12:00:00Z")), true);
  assert.strictEqual(count("leaderboard"), 0);
  assert.deepStrictEqual(
    (db.prepare("select distinct week from leaderboard_history order by week").all() as { week: string }[]).map((r) => r.week),
    ["2026-11-30", "2026-12-07"],
  );
  assert.strictEqual(count("leaderboard_history"), 6);
  db.close();
});

fs.rmSync(dir, { recursive: true, force: true });
console.log("\n" + n + " legacy-tester OK");
