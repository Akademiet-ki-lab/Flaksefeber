// The old leaderboard (from the Supabase version) is copied in once and can never change.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

fs.rmSync(dir, { recursive: true, force: true });
console.log("\n" + n + " legacy-tester OK");
