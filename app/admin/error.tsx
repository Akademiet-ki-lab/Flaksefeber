"use client";

// Shown instead of a blank page if something on /admin crashes in the browser
// (for example a browser extension that changes the page under React).
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="ffa-login">
      <div className="ffa-card ffa-login-card" role="alert">
        <h1>Noe gikk galt</h1>
        <p className="ffa-muted">
          Siden krasjet i nettleseren. Prøv på nytt, eller åpne siden i et privat vindu (uten
          utvidelser).
        </p>
        <p className="ffa-error">{error.message || "Ukjent feil"}</p>
        <button className="ffa-btn ffa-primary" type="button" onClick={() => reset()}>
          Prøv igjen
        </button>
        <a className="ffa-back" href="/">
          &#8249; Til spillet
        </a>
      </div>
    </main>
  );
}
