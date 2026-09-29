import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { Pool } from "pg";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());

const email = process.env.ADMIN_EMAIL?.trim();
const databaseUrl = process.env.DATABASE_URL;
if (!email || !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
  throw new Error("Set a valid ADMIN_EMAIL in .env.local or .env first.");
}
if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 8000 });
try {
  const existing = await pool.query(`SELECT 1 FROM "user" WHERE lower(email)=lower($1) AND role='admin' LIMIT 1`, [email]);
  if (existing.rowCount) {
    console.log("The configured admin already exists. Use npm run admin:reset-password if you need to recover access.");
    process.exit(0);
  }
} finally {
  await pool.end();
}

const args = ["--yes", "auth@latest", "create-admin", "--config", "./scripts/auth-cli.mts", "--email", email, "--name", "VIT-Admin", "--role", "admin"];
const child = process.platform === "win32"
  ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npx ${args.join(" ")}`], { stdio: "inherit" })
  : spawn("npx", args, { stdio: "inherit" });

child.on("error", (error) => {
  console.error("Could not start the Better Auth CLI:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
