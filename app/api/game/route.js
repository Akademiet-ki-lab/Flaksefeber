import { getDb } from "../../../lib/server/db.js";
import { handleGame } from "../../../lib/server/game.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req) {
  return handleGame(getDb(), req);
}
