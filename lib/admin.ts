import { getAuth } from "@/lib/auth";

export async function isAdmin(request: Request) {
  const allowedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!allowedEmail) return false;
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user.email.toLowerCase() === allowedEmail;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
