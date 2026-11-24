"use client";

// Player accounts for competition mode. Only admins can change a player's
// password or class (players can't). Deleting an account also removes its
// leaderboard row.
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { AdminAccount } from "../../lib/server/accounts";
import { api, errorOf, ERRORS } from "./api";

type Edit =
  | { id: number; kind: "info"; displayName: string; klass: string }
  | { id: number; kind: "password"; password: string };

export default function AccountsPanel({
  classes,
  say,
  onChanged,
}: {
  classes: string[];
  say: (text: string, bad?: boolean) => void;
  onChanged: () => void; // names and classes on the leaderboard follow the account
}) {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);

  const oops = (e: unknown) => {
    if (errorOf(e) !== "logged_out") say(ERRORS[errorOf(e)] || "Noe gikk galt.", true);
  };
  const load = useCallback(async () => {
    try {
      setAccounts((await api<{ accounts: AdminAccount[] }>("accounts")).accounts);
    } catch (e) {
      if (errorOf(e) !== "logged_out") say("Klarte ikke å hente brukerne.", true);
    }
  }, [say]);
  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!edit) return;
    const a = accounts?.find((x) => x.id === edit.id);
    try {
      if (edit.kind === "password") {
        if (edit.password.length < 6) return say(ERRORS.bad_password, true);
        await api("account-update", { id: edit.id, password: edit.password });
        say(`Nytt passord satt for ${a?.username}. Hen er logget ut og må logge inn med det nye.`);
      } else {
        await api("account-update", { id: edit.id, displayName: edit.displayName, klass: edit.klass });
        say(`Lagret ${a?.username}.`);
        onChanged();
      }
      setEdit(null);
      load();
    } catch (e) {
      oops(e);
      if (errorOf(e) === "not_found") load();
    }
  }

  async function remove(a: AdminAccount) {
    if (
      !window.confirm(
        `Slette brukeren ${a.username} (${a.displayName}, ${a.klass})?` +
          (a.best !== null ? ` Raden på topplista (${a.best} trær) slettes også.` : "") +
          " Dette kan ikke angres.",
      )
    )
      return;
    try {
      await api("account-delete", { id: a.id });
      say(`Slettet ${a.username}.`);
      load();
      onChanged();
    } catch (e) {
      oops(e);
      load();
    }
  }

  const q = search.trim().toLowerCase();
  const shown = (accounts || []).filter(
    (a) => !q || a.username.includes(q) || a.displayName.toLowerCase().includes(q),
  );
  const onEnter = (e: KeyboardEvent) => e.key === "Enter" && save();

  return (
    <section className="ffa-card">
      <div className="ffa-head">
        <h2>Brukere{accounts ? ` (${accounts.length})` : ""}</h2>
        <div className="ffa-filters">
          <input
            type="search"
            placeholder="Søk etter bruker"
            aria-label="Søk etter bruker"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <p className="ffa-muted">
        Elevene lager brukerne selv til konkurranse. Bare admin kan sette nytt passord og endre
        klasse.
      </p>

      {accounts === null ? (
        <p className="ffa-muted">Henter …</p>
      ) : shown.length === 0 ? (
        <p className="ffa-muted">{accounts.length ? "Ingen treff." : "Ingen brukere ennå."}</p>
      ) : (
        <div className="ffa-scroll">
          <table className="ffa-table">
            <thead>
              <tr>
                <th>Brukernavn</th>
                <th>Visningsnavn</th>
                <th>Klasse</th>
                <th className="ffa-num">Beste</th>
                <th aria-label="Handlinger"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const e = edit && edit.id === a.id ? edit : null;
                return (
                  <tr key={a.id} className={e ? "ffa-editing" : ""}>
                    <td>{a.username}</td>
                    {e && e.kind === "info" ? (
                      <>
                        <td>
                          <input
                            aria-label="Visningsnavn"
                            value={e.displayName}
                            maxLength={20}
                            onChange={(ev) => setEdit({ ...e, displayName: ev.target.value })}
                            onKeyDown={onEnter}
                          />
                        </td>
                        <td>
                          <select
                            aria-label="Klasse"
                            value={e.klass}
                            onChange={(ev) => setEdit({ ...e, klass: ev.target.value })}
                          >
                            {classes.map((k) => (
                              <option key={k}>{k}</option>
                            ))}
                          </select>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>{a.displayName}</td>
                        <td>{a.klass}</td>
                      </>
                    )}
                    <td className="ffa-num">{a.best ?? "–"}</td>
                    <td className="ffa-actions">
                      {e && e.kind === "password" && (
                        <input
                          aria-label={`Nytt passord for ${a.username}`}
                          className="ffa-pass-input"
                          type="text"
                          placeholder="Nytt passord (6+)"
                          autoComplete="off"
                          value={e.password}
                          onChange={(ev) => setEdit({ ...e, password: ev.target.value })}
                          onKeyDown={onEnter}
                          autoFocus
                        />
                      )}
                      {e ? (
                        <>
                          <button className="ffa-btn ffa-primary" type="button" onClick={save}>
                            Lagre
                          </button>
                          <button className="ffa-btn" type="button" onClick={() => setEdit(null)}>
                            Avbryt
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="ffa-btn"
                            type="button"
                            onClick={() =>
                              setEdit({ id: a.id, kind: "info", displayName: a.displayName, klass: a.klass })
                            }
                          >
                            Endre
                          </button>
                          <button
                            className="ffa-btn"
                            type="button"
                            onClick={() => setEdit({ id: a.id, kind: "password", password: "" })}
                          >
                            Nytt passord
                          </button>
                          <button className="ffa-btn ffa-danger" type="button" onClick={() => remove(a)}>
                            Slett
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
