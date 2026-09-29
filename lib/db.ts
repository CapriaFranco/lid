import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import "server-only";
let sqlClient: NeonQueryFunction<false, false> | undefined;
export function getSql() {
  // Read the environment only when a request uses the database. Next.js may
  // import route modules during build-time page analysis.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  sqlClient ??= neon(databaseUrl) as NeonQueryFunction<false, false>;
  return sqlClient;
}
