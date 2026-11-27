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

-- results from earlier weeks. The competition leaderboard is emptied every
-- Monday (see rollWeek), and what was on it is kept here for the all-time list.
-- No foreign key: the results stay even if the account is deleted.
create table if not exists leaderboard_history (
  id          integer primary key autoincrement,
  week        text not null,     -- the Monday (Oslo time) of the week the result is from
  account_id  integer,           -- null = added by an admin
  name        text not null,
  klass       text not null,
  best        integer not null check (best >= 0),
  achieved_at integer not null,
  hidden      integer not null default 0
);
create index if not exists leaderboard_history_week_idx on leaderboard_history (week);

-- small bits of server state, e.g. which week the leaderboard belongs to
create table if not exists meta (
  key   text primary key,
  value text not null
);

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

/*
  Weekly reset. The competition leaderboard is emptied every Monday at 00:00
  (Oslo time). Before that, every result on it is copied to leaderboard_history,
  so the all-time list keeps it. There is no timer: the first request after the
  Monday does the reset (getDb calls this), so it also works if the server was
  down over midnight. The first time this runs, it only notes the current week
  and changes nothing.
*/
const OSLO_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// the Monday (YYYY-MM-DD, Oslo time) that the week of `ms` started on
export function weekStart(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const back = OSLO_DAYS.indexOf(get("weekday"));
  const monday = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")) - back));
  return monday.toISOString().slice(0, 10);
}

export function rollWeek(db: DB, now: number): boolean {
  const week = weekStart(now);
  const stored = db.prepare("select value from meta where key = 'leaderboard_week'").get() as
    | { value: string }
    | undefined;
  if (stored?.value === week) return false;
  db.transaction(() => {
    const again = db.prepare("select value from meta where key = 'leaderboard_week'").get() as
      | { value: string }
      | undefined;
    if (again?.value === week) return;
    if (again) {
      db.prepare(
        `insert into leaderboard_history (week, account_id, name, klass, best, achieved_at, hidden)
         select ?, account_id, name, klass, best, achieved_at, hidden from leaderboard where best > 0`,
      ).run(again.value);
      db.prepare("delete from leaderboard").run();
    }
    db.prepare("insert or replace into meta (key, value) values ('leaderboard_week', ?)").run(week);
  })();
  return !!stored;
}

/*
  The "All time leaderboard" on the front page: the old Supabase leaderboard,
  the weeks that are over (leaderboard_history) and the current competition
  leaderboard in one list, best score first, with only the best score per
  person. Nothing is copied or changed. Hidden rows are left out.
  - A person on the competition side is an account (an admin-added row is its
    own person). Two accounts with the same name and class are never merged.
  - The old leaderboard has no accounts, so old rows with the same name and class
    are one person. Such a person is merged into the competition person with the
    same name and class when exactly one exists (the best score is kept), and
    otherwise stays a separate row.
  On a tie the old result goes first, then the one reached earliest.
*/
export function allTimeLeaderboard(db: DB): LegacyRow[] {
  type Entry = { name: string; klass: string; score: number; src: 0 | 1; at: number };
  const key = (name: string, klass: string) => name.trim().toLowerCase() + "|" + klass.trim().toLowerCase();

  // oldest week first, the current week last, so the newest name and class win
  const rows = db
    .prepare(
      `select account_id, name, klass, best, achieved_at, week, rid from (
         select id as rid, account_id, name, klass, best, achieved_at, week from leaderboard_history
           where hidden = 0 and best > 0
         union all
         select id as rid, account_id, name, klass, best, achieved_at, '9999-99-99' as week from leaderboard
           where hidden = 0 and best > 0
       ) order by week asc, rid asc`,
    )
    .all() as { account_id: number | null; name: string; klass: string; best: number; achieved_at: number; week: string; rid: number }[];

  const people = new Map<string, Entry>();
  for (const r of rows) {
    const k = r.account_id !== null ? "a" + r.account_id : "r" + r.week + "#" + r.rid;
    const p = people.get(k);
    if (!p) people.set(k, { name: r.name, klass: r.klass, score: r.best, src: 1, at: r.achieved_at });
    else {
      p.name = r.name;
      p.klass = r.klass;
      if (r.best > p.score) {
        p.score = r.best;
        p.at = r.achieved_at;
      }
    }
  }
  const current = [...people.values()];

  const oldBest = new Map<string, Entry>();
  for (const r of legacyLeaderboard(db)) {
    const k = key(r.name, r.klass);
    const seen = oldBest.get(k);
    if (!seen || r.score > seen.score)
      oldBest.set(k, { name: r.name, klass: r.klass, score: r.score, src: 0, at: r.rank });
  }

  const currentByKey = new Map<string, Entry[]>();
  for (const c of current) {
    const k = key(c.name, c.klass);
    currentByKey.set(k, [...(currentByKey.get(k) ?? []), c]);
  }

  const all: Entry[] = [...current];
  for (const [k, old] of oldBest) {
    const same = currentByKey.get(k) ?? [];
    if (same.length === 1) {
      if (old.score > same[0].score) {
        same[0].score = old.score;
        same[0].src = 0;
        same[0].at = old.at;
      }
    } else all.push(old);
  }

  all.sort((a, b) => b.score - a.score || a.src - b.src || a.at - b.at);
  return all.map((r, i) => ({ rank: i + 1, name: r.name, klass: r.klass, score: r.score }));
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
  rollWeek(g.__flaksefeberDb, Date.now());
  return g.__flaksefeberDb;
}

export function databaseVersion(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const file = path.join(dir, "database-version.txt");
  try {
    return fs.readFileSync(file, "utf8").trim() || "0000-0000-000000";
  } catch {
    return "0000-0000-000000";
  }
}
