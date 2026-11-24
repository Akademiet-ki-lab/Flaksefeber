import { cookies } from "next/headers";
import { getDb } from "../../lib/server/db";
import { adminFromToken, ADMIN_COOKIE } from "../../lib/server/admin";

// the logged-in admin's username, or null (checked on the server)
export async function currentAdmin(): Promise<string | null> {
  const jar = await cookies();
  return adminFromToken(getDb(), jar.get(ADMIN_COOKIE)?.value);
}
