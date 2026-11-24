// Small helpers shared by the API routes.

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
export const fail = (status: number, error: string) => json(status, { error });

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function isHttps(req: Request): boolean {
  if (process.env.COOKIE_SECURE === "1") return true;
  if (process.env.COOKIE_SECURE === "0") return false;
  const proto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (proto) return proto === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function cookieHeader(
  req: Request,
  name: string,
  value: string,
  { maxAge, sameSite = "Lax" }: { maxAge: number; sameSite?: "Lax" | "Strict" },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    ...(isHttps(req) ? ["Secure"] : []),
  ].join("; ");
}

export function clientIp(req: Request): string {
  // only trust proxy headers when we know a proxy (nginx/Caddy) sets them
  if (process.env.TRUST_PROXY === "1")
    return req.headers.get("x-real-ip") || "unknown";
  return "all";
}

// small in-memory limiter: at most `max` hits per `ms` for each key
const hits = new Map<string, number[]>();
export function limited(key: string, max: number, ms: number, { count = true } = {}): boolean {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < ms);
  const over = list.length >= max;
  if (!over && count) list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear(); // never grow without bound
  return over;
}
export function hit(key: string): void {
  const list = hits.get(key) || [];
  list.push(Date.now());
  hits.set(key, list);
}
export function resetLimits(): void {
  hits.clear();
}

// requests must come from our own page (blocks other sites posting with the cookie)
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers, curl, tests
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// a JSON object from the client: every field is unknown until checked
export type Body = Record<string, unknown>;

export async function readJson(
  req: Request,
  maxBytes: number,
): Promise<{ body: Body; error?: undefined } | { body?: undefined; error: 400 | 413 }> {
  const text = await req.text();
  if (text.length > maxBytes) return { error: 413 };
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { body: body as Body };
  } catch {
    return { error: 400 };
  }
}
