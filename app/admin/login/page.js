import { redirect } from "next/navigation";
import { currentAdmin } from "../session.js";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return <LoginForm />;
}
