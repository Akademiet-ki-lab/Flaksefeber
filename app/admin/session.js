import { cookies } from "next/headers";
import { getDb } from "../../lib/server/db.js";
import { adminFromToken, ADMIN_COOKIE } from "../../lib/server/admin.js";

// the logged-in admin's username, or null (checked on the server)
export async function currentAdmin() {
  const jar = await cookies();
  return adminFromToken(getDb(), jar.get(ADMIN_COOKIE)?.value);
}
