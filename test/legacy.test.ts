// The old leaderboard (from the Supabase version) is copied in once and can never change.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { openDb, legacyLeaderboard } from "../lib/server/db";
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

fs.rmSync(dir, { recursive: true, force: true });
console.log("\n" + n + " legacy-tester OK");
