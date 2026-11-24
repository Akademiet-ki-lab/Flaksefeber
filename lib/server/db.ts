/*
  The database: one SQLite file on the server (default ./data/flaksefeber.db,
  or the folder in DATA_DIR). Only this server process reads and writes it.
  The browser never sees it; it talks to /api/game.
*/
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import legacy from "./legacy-leaderboard.json";

export type { DB };

// rows as they come out of the tables (booleans are 0/1 in SQLite)
export type PlayerRow = {
  id: string;
  bests: string; // JSON array
  arenas: number;
  arena: number;
  xp: number;
  skin: number;
  seq: number;
  created_at: number;
  updated_at: number;
};
export type RunRow = {
  id: string;
  player_id: string;
  seed: number;
  seq: number;
  arena: number;
  mode: "normal" | "comp";
  started_at: number;
  finished: 0 | 1;
  account_id: number | null;
};
export type AccountRow = {
  id: number;
  username: string;
  display_name: string;
  klass: string;
  pass_hash: string;
  created_at: number;
  updated_at: number;
};
export type LeaderboardRow = {
  id: number;
  account_id: number | null;
  name: string;
  klass: string;
  best: number;
  achieved_at: number;
  updated_at: number;
  hidden: 0 | 1;
};
export type AdminRow = { username: string; pass_hash: string; created_at: number };
export type AdminSessionRow = { id: string; username: string; expires_at: number };
export type AdminLogRow = { id: number; username: string; action: string; details: string; at: number };
export type Count = { n: number };
export type LegacyRow = { rank: number; name: string; klass: string; score: number };

const SCHEMA = `
create table if not exists players (
  id         text primary key,          -- sha256 of the cookie token
  bests      text not null,             -- JSON array, record per arena
  arenas     integer not null default 1 check (arenas between 1 and 10),
  arena      integer not null default 0,
  xp         integer not null default 0 check (xp between 0 and 200),
  skin       integer not null default 0 check (skin between 0 and 6),
  seq        integer not null default 0, -- goes up with every finished run
  created_at integer not null,
  updated_at integer not null,
  check (arena >= 0 and arena < arenas)
);

-- accounts for competition mode (players make them themselves; only an admin
-- can change a password, on /admin)
create table if not exists accounts (
  id           integer primary key autoincrement,
  username     text not null unique,  -- lower case, used to log in
  display_name text not null,         -- shown on the leaderboard
  klass        text not null,
  pass_hash    text not null,         -- scrypt$salt$hash
  created_at   integer not null,
  updated_at   integer not null
);
create table if not exists account_sessions (
  id         text primary key,        -- sha256 of the cookie token
  account_id integer not null references accounts (id) on delete cascade,
  expires_at integer not null
);

create table if not exists runs (
  id         text primary key,
  player_id  text not null references players (id) on delete cascade,
  seed       integer not null,
  seq        integer not null,
  arena      integer not null,
  mode       text not null default 'normal' check (mode in ('normal', 'comp')),
  started_at integer not null,
  finished   integer not null default 0,
  account_id integer references accounts (id) on delete cascade -- competition runs only
);
create index if not exists runs_player_started_idx on runs (player_id, started_at);

create table if not exists leaderboard (
  id          integer primary key autoincrement,
  account_id  integer unique references accounts (id) on delete cascade, -- null = added by an admin
  name        text not null,
  klass       text not null,
  best        integer not null default 0 check (best >= 0),
  achieved_at integer not null,
  updated_at  integer not null,
  hidden      integer not null default 0  -- 1 = hidden from the public leaderboard
);
create index if not exists leaderboard_rank_idx
  on leaderboard (hidden, best desc, achieved_at asc);

-- people who can log in on /admin (added with: npm run admin -- add-user <name>)
create table if not exists admins (
  username   text primary key,  -- lower case
  pass_hash  text not null,     -- scrypt$salt$hash
  created_at integer not null
);
create table if not exists admin_sessions (
  id         text primary key,  -- sha256 of the cookie token
  username   text not null references admins (username) on delete cascade,
  expires_at integer not null
);
-- what admins have changed, and who did it
create table if not exists admin_log (
  id       integer primary key autoincrement,
  username text not null,
  action   text not null,
  details  text not null,
  at       integer not null
);
`;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  db.exec(SCHEMA);
  seedLegacy(db);
  return db;
}

/*
  The leaderboard from the old Supabase version, copied once at the switch
  (lib/server/legacy-leaderboard.json). It is only for looking back: after the
  first fill, triggers refuse every insert, update and delete, so nothing in
  the app (not even an admin) can change it.
*/
function seedLegacy(db: DB): void {
  db.exec(`
    create table if not exists legacy_leaderboard (
      rank  integer primary key,
      name  text not null,
      klass text not null,
      score integer not null
    );
  `);
  db.transaction(() => {
    const { n } = db.prepare("select count(*) as n from legacy_leaderboard").get() as Count;
    if (n === 0) {
      const insert = db.prepare(
        "insert into legacy_leaderboard (rank, name, klass, score) values (?, ?, ?, ?)",
      );
      for (const r of legacy.rows as LegacyRow[]) insert.run(r.rank, r.name, r.klass, r.score);
    }
    for (const what of ["insert", "update", "delete"])
      db.exec(`
        create trigger if not exists legacy_leaderboard_no_${what}
        before ${what} on legacy_leaderboard
        begin select raise(abort, 'legacy_leaderboard er skrivebeskyttet'); end;
      `);
  })();
}

export function legacyLeaderboard(db: DB): LegacyRow[] {
  return db
    .prepare("select rank, name, klass, score from legacy_leaderboard order by rank")
    .all() as LegacyRow[];
}

export const legacyFetchedAt: string = legacy.fetchedAt;

const columns = (db: DB, table: string) =>
  (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

function migrate(db: DB): void {
  // Competition mode now needs an account, and the leaderboard belongs to
  // accounts instead of browsers. The leaderboard from before (one row per
  // browser) is cleared once, here. The old Supabase leaderboard lives on,
  // untouched, in legacy_leaderboard.
  const lb = columns(db, "leaderboard");
  if (lb.length && !lb.includes("account_id")) {
    db.exec(`
      begin;
      drop index if exists leaderboard_rank_idx;
      drop table leaderboard;
      commit;
    `);
  }
  // runs remember which account started a competition run
  const runs = columns(db, "runs");
  if (runs.length && !runs.includes("account_id"))
    db.exec("alter table runs add column account_id integer references accounts (id) on delete cascade");
}

export function dbFile(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "flaksefeber.db");
}

// one connection per server process (kept across hot reloads in development)
const g = globalThis as typeof globalThis & { __flaksefeberDb?: DB };
export function getDb(): DB {
  if (!g.__flaksefeberDb) g.__flaksefeberDb = openDb(dbFile());
  return g.__flaksefeberDb;
}
