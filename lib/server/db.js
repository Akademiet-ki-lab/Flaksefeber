/*
  The database: one SQLite file on the server (default ./data/flaksefeber.db,
  or the folder in DATA_DIR). Only this server process reads and writes it.
  The browser never sees it; it talks to /api/game.
*/
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

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

create table if not exists runs (
  id         text primary key,
  player_id  text not null references players (id) on delete cascade,
  seed       integer not null,
  seq        integer not null,
  arena      integer not null,
  mode       text not null default 'normal' check (mode in ('normal', 'comp')),
  started_at integer not null,
  finished   integer not null default 0
);
create index if not exists runs_player_started_idx on runs (player_id, started_at);

create table if not exists leaderboard (
  id          integer primary key autoincrement,
  player_id   text unique references players (id) on delete cascade, -- null = added by an admin
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

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  db.exec(SCHEMA);
  return db;
}

// older databases had player_id as the leaderboard's primary key; give the
// table its own id so admins can add rows that don't belong to a player
function migrate(db) {
  const cols = db.prepare("pragma table_info(leaderboard)").all();
  if (!cols.length || cols.some((c) => c.name === "id")) return;
  db.exec(`
    begin;
    alter table leaderboard rename to leaderboard_old;
    drop index if exists leaderboard_rank_idx;
    create table leaderboard (
      id          integer primary key autoincrement,
      player_id   text unique references players (id) on delete cascade,
      name        text not null,
      klass       text not null,
      best        integer not null default 0 check (best >= 0),
      achieved_at integer not null,
      updated_at  integer not null,
      hidden      integer not null default 0
    );
    insert into leaderboard (player_id, name, klass, best, achieved_at, updated_at, hidden)
      select player_id, name, klass, best, achieved_at, updated_at, hidden from leaderboard_old;
    drop table leaderboard_old;
    commit;
  `);
}

export function dbFile() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "flaksefeber.db");
}

// one connection per server process (kept across hot reloads in development)
export function getDb() {
  const g = globalThis;
  if (!g.__flaksefeberDb) g.__flaksefeberDb = openDb(dbFile());
  return g.__flaksefeberDb;
}
