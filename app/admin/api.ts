// Calls /api/admin from the admin pages. A lost login sends the admin back to
// the login page.
export async function api<T = Record<string, never>>(action: string, body: object = {}): Promise<T> {
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

export const errorOf = (e: unknown) => (e instanceof Error ? e.message : "error");

export const ERRORS: Record<string, string> = {
  bad_name: "Navnet må ha 1–20 tegn.",
  bad_klass: "Velg en klasse.",
  bad_score: "Score må være et helt tall fra 0 og oppover.",
  bad_password: "Passordet må ha minst 6 tegn.",
  not_found: "Finnes ikke lenger. Lista er lastet på nytt.",
};
