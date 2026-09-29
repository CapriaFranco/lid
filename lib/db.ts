import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import "server-only";
const databaseUrl = process.env.DATABASE_URL;
let sqlClient: NeonQueryFunction<false, false> | undefined;
export function getSql() {
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  sqlClient ??= neon(databaseUrl) as NeonQueryFunction<false, false>;
  return sqlClient;
}
