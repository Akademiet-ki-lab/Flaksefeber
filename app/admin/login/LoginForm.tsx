"use client";

import { useState, type FormEvent } from "react";

const ERRORS: Record<string, string> = {
  wrong_login: "Feil brukernavn eller passord.",
  rate: "For mange forsøk. Vent et kvarter og prøv igjen.",
};

export default function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          username: f.get("username"),
          password: f.get("password"),
        }),
      });
      if (r.ok) {
        window.location.href = "/admin";
        return;
      }
      const data: { error?: string } = await r.json().catch(() => ({}));
      setError((data.error && ERRORS[data.error]) || "Noe gikk galt. Prøv igjen.");
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    }
    setBusy(false);
  }

  return (
    <main className="ad-login">
      <form className="ad-card ad-login-card" onSubmit={submit}>
        <h1>Admin</h1>
        <p className="ad-muted">Logg inn for å endre topplista.</p>
        <label htmlFor="username">Brukernavn</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <label htmlFor="password">Passord</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <p className="ad-error" role="alert">
          {error}
        </p>
        <button className="ad-btn ad-primary" type="submit" disabled={busy}>
          {busy ? "Logger inn …" : "Logg inn"}
        </button>
        <a className="ad-back" href="/">
          &#8249; Til spillet
        </a>
      </form>
    </main>
  );
}
