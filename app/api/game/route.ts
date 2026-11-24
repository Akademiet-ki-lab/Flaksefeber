import { getDb } from "../../../lib/server/db";
import { handleGame } from "../../../lib/server/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleGame(getDb(), req);
}
