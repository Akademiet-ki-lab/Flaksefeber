import { getDb } from "../../../lib/server/db";
import { handleAdmin } from "../../../lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleAdmin(getDb(), req);
}
