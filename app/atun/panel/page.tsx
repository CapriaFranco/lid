import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import AdminDashboard from "./view";

export const dynamic = "force-dynamic";

export default async function AdminPanelPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!session || !adminEmail || session.user.email.toLowerCase() !== adminEmail) redirect("/atun");
  return <AdminDashboard email={session.user.email} />;
}
