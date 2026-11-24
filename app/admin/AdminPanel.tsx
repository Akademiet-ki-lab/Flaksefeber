"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AdminLeaderboardRow } from "../../lib/server/admin";

type Row = AdminLeaderboardRow;
type Editing = { id: number; name: string; klass: string; score: string };

const ERRORS: Record<string, string> = {
  bad_name: "Navnet må ha 1–20 tegn.",
  bad_klass: "Velg en klasse.",
  bad_score: "Score må være et helt tall fra 0 og oppover.",
  not_found: "Raden finnes ikke lenger. Lista er lastet på nytt.",
};

async function api<T = Record<string, never>>(action: string, body: object = {}): Promise<T> {
  const r = await fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  if (r.status === 401) {
    window.location.href = "/admin/login";
    throw new Error("logged_out");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "error");
  return data as T;
}

const toScore = (v: string) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);

export default function AdminPanel({ username, classes }: { username: string; classes: string[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [klass, setKlass] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState({ text: "", bad: false });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [add, setAdd] = useState({ name: "", klass: classes[0], score: "" });

  const say = (text: string, bad = false) => setMsg({ text, bad });
  const errorOf = (e: unknown) => (e instanceof Error ? e.message : "error");
  const oops = (e: unknown) => {
    if (errorOf(e) !== "logged_out") say(ERRORS[errorOf(e)] || "Noe gikk galt.", true);
  };

  const load = useCallback(async () => {
    try {
      const data = await api<{ rows: Row[] }>("list", klass ? { klass } : {});
      setRows(data.rows);
    } catch (e) {
      if (errorOf(e) !== "logged_out") say("Klarte ikke å hente topplista.", true);
    }
  }, [klass]);
  useEffect(() => {
    load();
  }, [load]);

  async function addRow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const score = toScore(add.score);
    if (Number.isNaN(score)) return say(ERRORS.bad_score, true);
    try {
      const { row } = await api<{ row: Row }>("add", { name: add.name, klass: add.klass, score });
      setAdd({ ...add, name: "", score: "" });
      say(`La til ${row.name} (${row.klass}) med ${row.score} trær.`);
      load();
    } catch (err) {
      oops(err);
    }
  }

  async function save() {
    if (!editing) return;
    const score = toScore(editing.score);
    if (Number.isNaN(score)) return say(ERRORS.bad_score, true);
    try {
      const { row } = await api<{ row: Row }>("update", {
        id: editing.id,
        name: editing.name,
        klass: editing.klass,
        score,
      });
      setEditing(null);
      say(`Lagret ${row.name}.`);
      load();
    } catch (err) {
      oops(err);
      if (errorOf(err) === "not_found") load();
    }
  }

  async function toggleHidden(r: Row) {
    try {
      await api("update", { id: r.id, hidden: !r.hidden });
      say(r.hidden ? `${r.name} vises igjen.` : `${r.name} er skjult fra topplista.`);
      load();
    } catch (err) {
      oops(err);
    }
  }

  async function remove(r: Row) {
    if (!window.confirm(`Slette ${r.name} (${r.klass}, ${r.score} trær)? Dette kan ikke angres.`))
      return;
    try {
      await api("delete", { id: r.id });
      say(`Slettet ${r.name}.`);
      load();
    } catch (err) {
      oops(err);
      load();
    }
  }

  async function logout() {
    await api("logout").catch(() => {});
    window.location.href = "/admin/login";
  }

  // place on the public list: hidden rows don't take a place
  let place = 0;
  const shown = (rows || []).map((r) => ({ ...r, place: r.hidden ? null : ++place }));
  const q = search.trim().toLowerCase();
  const visible = q ? shown.filter((r) => r.name.toLowerCase().includes(q)) : shown;

  return (
    <main className="ffa-main">
      <header className="ffa-top">
        <h1>Flaksefeber admin</h1>
        <div className="ffa-who">
          <span>
            Innlogget som <strong>{username}</strong>
          </span>
          <a className="ffa-btn" href="/">
            Til spillet
          </a>
          <button className="ffa-btn" type="button" onClick={logout}>
            Logg ut
          </button>
        </div>
      </header>

      <p className={"ffa-msg" + (msg.bad ? " ffa-bad" : "")} role="status" aria-live="polite">
        {msg.text}
      </p>

      <section className="ffa-card">
        <h2>Legg til på topplista</h2>
        <form className="ffa-add" onSubmit={addRow}>
          <label>
            Navn
            <input
              value={add.name}
              maxLength={20}
              required
              onChange={(e) => setAdd({ ...add, name: e.target.value })}
            />
          </label>
          <label>
            Klasse
            <select value={add.klass} onChange={(e) => setAdd({ ...add, klass: e.target.value })}>
              {classes.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Score
            <input
              value={add.score}
              inputMode="numeric"
              required
              onChange={(e) => setAdd({ ...add, score: e.target.value })}
            />
          </label>
          <button className="ffa-btn ffa-primary" type="submit">
            Legg til
          </button>
        </form>
      </section>

      <section className="ffa-card">
        <div className="ffa-head">
          <h2>Toppliste</h2>
          <div className="ffa-filters">
            <input
              type="search"
              placeholder="Søk etter navn"
              aria-label="Søk etter navn"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select aria-label="Klasse" value={klass} onChange={(e) => setKlass(e.target.value)}>
              <option value="">Alle klasser</option>
              {classes.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </div>
        </div>

        {rows === null ? (
          <p className="ffa-muted">Henter …</p>
        ) : visible.length === 0 ? (
          <p className="ffa-muted">Ingen rader her.</p>
        ) : (
          <div className="ffa-scroll">
            <table className="ffa-table">
              <thead>
                <tr>
                  <th className="ffa-num">Plass</th>
                  <th>Navn</th>
                  <th>Klasse</th>
                  <th className="ffa-num">Score</th>
                  <th>Status</th>
                  <th aria-label="Handlinger"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) =>
                  editing && editing.id === r.id ? (
                    <tr key={r.id} className="ffa-editing">
                      <td className="ffa-num">{r.place ?? "–"}</td>
                      <td>
                        <input
                          aria-label="Navn"
                          value={editing.name}
                          maxLength={20}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Klasse"
                          value={editing.klass}
                          onChange={(e) => setEditing({ ...editing, klass: e.target.value })}
                        >
                          {classes.map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </td>
                      <td className="ffa-num">
                        <input
                          aria-label="Score"
                          className="ffa-score-input"
                          inputMode="numeric"
                          value={editing.score}
                          onChange={(e) => setEditing({ ...editing, score: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && save()}
                        />
                      </td>
                      <td></td>
                      <td className="ffa-actions">
                        <button className="ffa-btn ffa-primary" type="button" onClick={save}>
                          Lagre
                        </button>
                        <button className="ffa-btn" type="button" onClick={() => setEditing(null)}>
                          Avbryt
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id} className={r.hidden ? "ffa-hidden" : ""}>
                      <td className="ffa-num">{r.place ?? "–"}</td>
                      <td>{r.name}</td>
                      <td>{r.klass}</td>
                      <td className="ffa-num">{r.score}</td>
                      <td>
                        {r.hidden && <span className="ffa-tag">Skjult</span>}
                        {!r.player && <span className="ffa-tag ffa-tag-admin">Lagt til av admin</span>}
                      </td>
                      <td className="ffa-actions">
                        <button
                          className="ffa-btn"
                          type="button"
                          onClick={() =>
                            setEditing({ id: r.id, name: r.name, klass: r.klass, score: String(r.score) })
                          }
                        >
                          Endre
                        </button>
                        <button className="ffa-btn" type="button" onClick={() => toggleHidden(r)}>
                          {r.hidden ? "Vis" : "Skjul"}
                        </button>
                        <button className="ffa-btn ffa-danger" type="button" onClick={() => remove(r)}>
                          Slett
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
