import { createRequire } from "node:module";
import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());

const email = process.env.ADMIN_EMAIL?.trim();
const databaseUrl = process.env.DATABASE_URL;
if (!email || !databaseUrl) throw new Error("ADMIN_EMAIL and DATABASE_URL must be configured locally.");
if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
  throw new Error("Run this command directly in an interactive terminal; password input must stay hidden.");
}

function readSecret(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";
    process.stdout.write(`${label} (entrada oculta): `);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();

    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003" || char === "\u0004") return finish(new Error("Password reset cancelled."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (char >= " " && char !== "\u001b") value += char;
      }
    };
    input.on("data", onData);
  });
}

const first = await readSecret("Nueva contraseña");
const second = await readSecret("Repetí la contraseña");
if (first.length < 12 || first.length > 128) throw new Error("Use entre 12 y 128 caracteres.");
if (first !== second) throw new Error("Las contraseñas no coinciden; no se cambió nada.");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 8000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const account = await client.query(`SELECT a.id, a."userId" AS user_id
    FROM account a JOIN "user" u ON u.id = a."userId"
    WHERE lower(u.email) = lower($1) AND u.role = 'admin' AND a."providerId" = 'credential'
    FOR UPDATE OF a`, [email]);
  if (account.rowCount !== 1) throw new Error("Expected exactly one credential account for the configured admin.");
  const passwordHash = await hashPassword(first);
  await client.query("UPDATE account SET password = $1, \"updatedAt\" = now() WHERE id = $2", [passwordHash, account.rows[0].id]);
  await client.query("DELETE FROM session WHERE \"userId\" = $1", [account.rows[0].user_id]);
  await client.query("COMMIT");
  console.log("Admin password updated; existing sessions were revoked.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
