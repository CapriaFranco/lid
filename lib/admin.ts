import { getAuth } from "@/lib/auth";

export async function isAdmin(request: Request) {
  const allowedEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!allowedEmail) return false;
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user.email.toLowerCase() === allowedEmail;
}

export function sameOrigin(request: Request) {
  let sourceUrl: URL;
  try {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (origin) sourceUrl = new URL(origin);
    else if (referer) sourceUrl = new URL(referer);
    else return false;
  } catch { return false; }

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestProtocol = forwardedProto ? `${forwardedProto.replace(/:$/, "")}:` : requestUrl.protocol;
  const expectedOrigin = `${requestProtocol}//${requestHost}`;
  if (sourceUrl.origin === requestUrl.origin || sourceUrl.origin === new URL(expectedOrigin).origin) return true;

  if (process.env.NODE_ENV === "production") return false;
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const localPort = (url: URL) => url.port || (url.protocol === "https:" ? "443" : "80");
  const allowedLocal = (url: URL) => url.protocol === "http:" && localHosts.has(url.hostname) && localPort(url) === localPort(requestUrl);
  return allowedLocal(sourceUrl) && allowedLocal(requestUrl);
}
