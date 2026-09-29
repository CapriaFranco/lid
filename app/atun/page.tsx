import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AdminLogin from "./signin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (session?.user.email.toLowerCase() === adminEmail && adminEmail) redirect("/atun/panel");
  return <AdminLogin />;
}
