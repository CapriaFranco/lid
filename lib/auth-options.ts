import { admin } from "better-auth/plugins";
import { Pool } from "pg";

let pool: Pool | undefined;

export function getAuthOptions() {
  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const appUrl = process.env.BETTER_AUTH_URL ?? (process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000");

  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  if (!appUrl) throw new Error("BETTER_AUTH_URL is required in production");

  pool ??= new Pool({ connectionString: databaseUrl, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });

  const trustedOrigins = new Set([appUrl]);
  if (process.env.NODE_ENV !== "production") {
    const port = new URL(appUrl).port || "3000";
    trustedOrigins.add(`http://localhost:${port}`);
    trustedOrigins.add(`http://127.0.0.1:${port}`);
  }

  return {
    appName: "LID 2026",
    baseURL: appUrl,
    secret,
    database: pool,
    trustedOrigins: [...trustedOrigins],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: { expiresIn: 60 * 60 * 8, updateAge: 60 * 15 },
    rateLimit: {
      enabled: true,
      storage: "database" as const,
      window: 60,
      max: 10,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      database: { validateSchema: false },
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
  };
}
