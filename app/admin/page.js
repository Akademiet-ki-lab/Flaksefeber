import { redirect } from "next/navigation";
import Sim from "../../lib/game/sim.js";
import { currentAdmin } from "./session.js";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const username = await currentAdmin();
  if (!username) redirect("/admin/login");
  return <AdminPanel username={username} classes={[...Sim.CONST.CLASSES]} />;
}
