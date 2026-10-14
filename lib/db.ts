import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import postgres from "postgres";
import "server-only";
let sqlClient: NeonQueryFunction<false, false> | undefined;
export function getSql() {
  // Read the environment only when a request uses the database. Next.js may
  // import route modules during build-time page analysis.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) {
    if (process.env.LID_DATABASE_DRIVER === "postgres") {
      const parsed = new URL(databaseUrl);
      const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
      if (process.env.NODE_ENV === "production" || !localHosts.has(parsed.hostname)) {
        throw new Error("The postgres database driver is restricted to local development hosts");
      }
      sqlClient = postgres(databaseUrl, { max: 5, idle_timeout: 10 }) as unknown as NeonQueryFunction<false, false>;
    } else {
      sqlClient = neon(databaseUrl) as NeonQueryFunction<false, false>;
    }
  }
  return sqlClient;
}
