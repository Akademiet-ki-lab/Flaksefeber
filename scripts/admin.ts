// Admin tool for the server. Run on the VPS in the project folder.
//
// Admin users (for the login on /admin):
//   npm run admin -- add-user <brukernavn>     add a user or set a new password (asks for it)
//   npm run admin -- remove-user <brukernavn>
//   npm run admin -- users
//
// Leaderboard (the same can be done on /admin):
//   npm run admin -- list [klasse]      top 50, with hidden rows marked
//   npm run admin -- hide <nr>          hide the row with this number from `list`
//   npm run admin -- show <nr>          show it again
//   npm run admin -- log                the last 30 changes made on /admin
//   npm run admin -- stats              number of players, runs and leaderboard rows
//   npm run admin -- backup             safe copy of the database to data/backups/ (keeps the last 20)
import fs from "node:fs";
import path from "node:path";
import { openDb, dbFile } from "../lib/server/db";
import { addAdmin, removeAdmin } from "../lib/server/admin";
import type { AdminLogRow, Count, LeaderboardRow } from "../lib/server/db";

const db = openDb(dbFile());
const [cmd, arg] = process.argv.slice(2);

let piped: Promise<string[]> | null = null;
function pipedLines(): Promise<string[]> {
  if (!piped)
    piped = new Promise((resolve) => {
      let buf = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => (buf += c));
      process.stdin.on("end", () => resolve(buf.split(/\r?\n/)));
    });
  return piped;
}

// read a line from the terminal without showing what is typed
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    if (!stdin.isTTY) {
      // piped input (e.g. from a script): one line per question
      stdout.write("\n");
      return pipedLines().then((lines: string[]) => resolve(lines.shift() ?? ""));
    }
    let pw = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(pw);
      } else if (ch === "\u0003") {
        stdout.write("\n");
        process.exit(1);
      } else if (ch === "\u007f" || ch === "\b") pw = pw.slice(0, -1);
      else pw += ch;
    };
    stdin.on("data", onData);
  });
}

const all = (klass?: string) =>
  db
    .prepare(
      `select id, name, klass, best, hidden from leaderboard
       ${klass ? "where klass = ?" : ""} order by best desc, achieved_at asc limit 50`,
    )
    .all(...(klass ? [klass] : [])) as Pick<LeaderboardRow, "id" | "name" | "klass" | "best" | "hidden">[];

if (cmd === "add-user") {
  if (!arg) {
    console.log("Bruk: npm run admin -- add-user <brukernavn>");
    process.exit(1);
  }
  const pw = await askHidden("Passord (minst 10 tegn): ");
  const again = await askHidden("Gjenta passord: ");
  if (pw !== again) {
    console.log("Passordene var ikke like.");
    process.exit(1);
  }
  try {
    console.log("OK, " + addAdmin(db, arg, pw) + " kan logge inn på /admin");
  } catch (e) {
    console.log(e instanceof Error ? e.message : e);
    process.exit(1);
  }
} else if (cmd === "remove-user") {
  console.log(removeAdmin(db, arg) ? "Fjernet" : "Fant ingen bruker " + arg);
} else if (cmd === "users") {
  const rows = db.prepare("select username from admins order by username").all() as { username: string }[];
  console.log(rows.length ? rows.map((r) => r.username).join("\n") : "Ingen admin-brukere ennå");
} else if (cmd === "list") {
  for (const r of all(arg))
    console.log(
      String(r.id).padStart(5),
      String(r.best).padStart(5),
      r.klass.padEnd(7),
      r.name,
      r.hidden ? "  [skjult]" : "",
    );
} else if (cmd === "hide" || cmd === "show") {
  const r = db
    .prepare("update leaderboard set hidden = ? where id = ?")
    .run(cmd === "hide" ? 1 : 0, Number(arg));
  console.log(r.changes ? "OK" : "Fant ingen rad med nr " + arg);
} else if (cmd === "log") {
  const rows = db.prepare("select * from admin_log order by id desc limit 30").all() as AdminLogRow[];
  for (const r of rows)
    console.log(new Date(r.at).toLocaleString("nb-NO"), r.username.padEnd(12), r.action.padEnd(7), r.details);
} else if (cmd === "backup") {
  // SQLite's own backup: safe while the server is running
  const dir = path.join(path.dirname(dbFile()), "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `flaksefeber-${stamp}.db`);
  await db.backup(file);
  const old = fs.readdirSync(dir).filter((f) => /^flaksefeber-.*\.db$/.test(f)).sort();
  for (const f of old.slice(0, -20)) fs.rmSync(path.join(dir, f));
  console.log("Backup: " + file);
} else if (cmd === "stats") {
  for (const t of ["players", "runs", "leaderboard", "admins"])
    console.log(t.padEnd(12), (db.prepare(`select count(*) as n from ${t}`).get() as Count).n);
} else {
  console.log(
    "Bruk: npm run admin -- add-user <navn> | remove-user <navn> | users | list [klasse] | hide <nr> | show <nr> | log | stats | backup",
  );
}
