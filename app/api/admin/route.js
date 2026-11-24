import { getDb } from "../../../lib/server/db.js";
import { handleAdmin } from "../../../lib/server/admin.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req) {
  return handleAdmin(getDb(), req);
}
