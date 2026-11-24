"use client";

// Last resort if the whole app crashes: always visible (own colours, no CSS needed).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="nb">
      <body style={{ margin: 0, background: "#0e2036", color: "#f5f9fc", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
          <div style={{ maxWidth: 420, textAlign: "center" }} role="alert">
            <h1 style={{ margin: "0 0 0.5em" }}>Noe gikk galt</h1>
            <p style={{ opacity: 0.8 }}>Prøv på nytt, eller åpne siden i et privat vindu.</p>
            <p style={{ color: "#ffb3ae", fontWeight: 700 }}>{error.message || "Ukjent feil"}</p>
            <button
              type="button"
              onClick={() => reset()}
              style={{ font: "inherit", fontWeight: 800, padding: "0.6em 1.4em", borderRadius: 8, border: 0, background: "#d6403a", color: "#fff", cursor: "pointer" }}
            >
              Prøv igjen
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
