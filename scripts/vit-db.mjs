import { createRequire } from "node:module";
import pg from "pg";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const adminEmail = process.env.ADMIN_EMAIL || "demo@vit.local";
if (!databaseUrl) throw new Error("DATABASE_URL is empty; set it in .env.local (preferred) or .env.");
if (!databaseUrl.startsWith("postgresql://") || !databaseUrl.includes(".neon.tech") || !/sslmode=(?:require|verify-full)/i.test(databaseUrl)) {
  throw new Error("DATABASE_URL must be a Neon PostgreSQL URL with sslmode=require or sslmode=verify-full.");
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 8000, idleTimeoutMillis: 5000 });
const migrations = ["migration_vit_registration.sql", "migration_vit_admin.sql", "migration_vit_security.sql", "migration_vit_roster.sql", "migration_vit_norms.sql", "migration_vit_optimization.sql", "migration_vit_admin_dashboard_details.sql", "migration_vit_registration_behavior.sql", "migration_vit_registration_authorization_backfill.sql", "migration_vit_admin_roster_behavior.sql", "migration_vit_admin_team_patch.sql", "migration_vit_norm_content.sql", "migration_vit_norm_rich_editor.sql", "migration_vit_norm_document_validation.sql", "migration_vit_norm_document_validation_hardening.sql", "migration_vit_norm_editor_palette.sql", "migration_vit_norm_text_scripts.sql", "migration_vit_norm_reserved_bar_colors.sql"];

async function migrate() {
  await pool.query("CREATE TABLE IF NOT EXISTS vit_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of migrations) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const applied = await client.query("SELECT 1 FROM vit_schema_migrations WHERE name = $1", [name]);
      if (applied.rowCount) {
        console.log(`Already applied: ${name}`);
      } else {
        const sql = await readFile(resolve("sql", name), "utf8");
        await client.query(sql);
        await client.query("INSERT INTO vit_schema_migrations(name) VALUES ($1)", [name]);
        console.log(`Applied: ${name}`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  console.log("Database migrations are current.");
}

async function check() {
  const result = await pool.query(`SELECT current_database() AS database, current_user AS role,
    to_regclass('public.vit_teams') IS NOT NULL AS teams,
    to_regclass('public.vit_players') IS NOT NULL AS players, (SELECT count(*)::int FROM vit_players WHERE autorizacion) AS authorized_players,
    to_regclass('public.vit_registration_codes') IS NOT NULL AS codes,
    to_regclass('public.vit_norm_categories') IS NOT NULL AS norm_categories,
    to_regclass('public."user"') IS NOT NULL AS auth_users,
    to_regclass('public.vit_courses') IS NOT NULL AS normalized_courses,
    to_regclass('public.vit_course_divisions') IS NOT NULL AS normalized_divisions,
    to_regprocedure('public.register_vit_team(jsonb,text)') IS NOT NULL AS registration_procedure,
    to_regprocedure('public.admin_update_vit_team(bigint,text,jsonb,text)') IS NOT NULL AS admin_procedure,
    to_regprocedure('public.admin_patch_vit_team(bigint,text,jsonb,text)') IS NOT NULL AS admin_patch_procedure,
    to_regprocedure('public.admin_save_vit_norm(bigint,bigint,text,text,text,boolean,jsonb,text,text)') IS NOT NULL AS admin_norm_save_procedure,
    to_regprocedure('public.vit_norm_document_valid(jsonb)') IS NOT NULL AS norm_document_validator,
    vit_norm_document_valid('{"type":"doc","content":[{"type":"paragraph","attrs":{"indent":0,"showBar":true,"barColor":"#E01B84","textAlign":"left"},"content":[{"type":"text","text":"aviso","marks":[{"type":"textColor","attrs":{"color":"#F03732"}},{"type":"superscript"}]}]}]}'::jsonb) AS norm_palette_format_valid`);
  console.table(result.rows);
}

async function seedDemo() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const samples = [
      { course: "1ro", division: "A", name: "DEMO VIT LOBOS", system: "6:0", type: null, color: "azul marino", players: [["Demo Capitan Uno", "Punta"], ["Demo Jugador Dos", "Opuesto"], ["Demo Jugador Tres", "Central"], ["Demo Jugador Cuatro", "Armador"], ["Demo Jugador Cinco", "Libero"], ["Demo Jugador Seis", "Punta"]], consent: true },
      { course: "2do", division: "B", name: "DEMO VIT HALCONES", system: "4:2", type: "c", color: "blanco y verde", players: [["Demo Capitan Siete", "Punta"], ["Demo Jugador Ocho", "Opuesto"], ["Demo Jugador Nueve", "Central"], ["Demo Jugador Diez", "Armador"], ["Demo Jugador Once", "Libero"], ["Demo Jugador Doce", "Punta"], ["Demo Jugador Trece", null]], consent: false },
      { course: "4to", division: "1ra", name: "DEMO VIT PUMAS", system: "5:1", type: null, color: "negro con dorado", players: [["Demo Capitan Catorce", "Punta"], ["Demo Jugador Quince", "Opuesto"], ["Demo Jugador Dieciseis", "Central"], ["Demo Jugador Diecisiete", "Armador"], ["Demo Jugador Dieciocho", "Libero"], ["Demo Jugador Diecinueve", "Punta"], ["Demo Jugador Veinte", null]], consent: true },
      { course: "6to", division: "2da", name: "DEMO VIT CONDORES", system: "4:2", type: "o", color: "celeste y blanco", players: [["Demo Capitan Veintidos", "Punta"], ["Demo Jugador Veintitres", "Opuesto"], ["Demo Jugador Veinticuatro", "Central"], ["Demo Jugador Veinticinco", "Armador"], ["Demo Jugador Veintiseis", "Libero"], ["Demo Jugador Veintisiete", "Punta"]], consent: false },
    ];
    for (const sample of samples) {
      const found = await client.query("SELECT id FROM vit_teams WHERE nombre_equipo = $1", [sample.name]);
      if (found.rowCount) continue;
      const team = await client.query(`INSERT INTO vit_teams(course_division_id, nombre_equipo, sistema_juego, tipo_cuatro_dos, color_remera, telefono, justificacion_admin)
        VALUES ((SELECT id FROM vit_course_divisions WHERE curso_codigo=$1 AND codigo=$2),$3,$4,$5,$6,$7,NULL) RETURNING id`, [sample.course, sample.division, sample.name, sample.system, sample.type, sample.color, "1100000000"]);
      for (const [index, [player, position]] of sample.players.entries()) {
        await client.query("INSERT INTO vit_players(id_equipo,nombre,posicion,suplente,autorizacion,orden) VALUES ($1,$2,$3,$4,$5,$6)", [team.rows[0].id, player, position, index >= 6, sample.consent && index % 3 !== 1, index]);
      }
      await client.query("INSERT INTO vit_admin_audit_logs(actor_email,action,entity_type,entity_id,details) VALUES ($1,'demo.seed','team',$2,$3)", [adminEmail.toLowerCase(), String(team.rows[0].id), JSON.stringify({ demo: true, name: sample.name })]);
    }
    await client.query("COMMIT");
    console.log("Demo data is present (names are prefixed DEMO VIT).");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupDemo() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM vit_admin_audit_logs WHERE entity_type='team' AND entity_id IN (SELECT id::text FROM vit_teams WHERE nombre_equipo LIKE 'DEMO VIT %')");
    await client.query("DELETE FROM vit_teams WHERE nombre_equipo LIKE 'DEMO VIT %'");
    await client.query("COMMIT");
    console.log("Demo teams and their players were removed.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resetNorms() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE vit_norm_categories, vit_norms IN EXCLUSIVE MODE");
    await client.query("DELETE FROM vit_norms");
    await client.query("DELETE FROM vit_norm_categories");
    const category = await client.query(
      "INSERT INTO vit_norm_categories (slug, nombre, descripcion, orden, activa) VALUES ('reglamento', 'Reglamento', '', 0, true) RETURNING id",
    );
    await client.query(
      `INSERT INTO vit_norms (category_id, slug, titulo, resumen, publicado, orden, documento)
       VALUES ($1, 'normas-del-torneo', 'Normas del torneo', '', false, 0,
         '{"type":"doc","content":[{"type":"paragraph","attrs":{"indent":0,"showBar":false,"barColor":"#E01B84","textAlign":"left"}}]}'::jsonb)`,
      [category.rows[0].id],
    );
    await client.query("COMMIT");
    console.log("Normas reset: quedó una categoría interna y una hoja vacía; equipos, códigos y usuarios se conservaron.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function resetTournamentData() {
  if (process.env.CONFIRM_VIT_DATA_RESET !== "RESET_VIT_TOURNAMENT_DATA") {
    throw new Error("Refusing to reset data. Set CONFIRM_VIT_DATA_RESET=RESET_VIT_TOURNAMENT_DATA to confirm.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE vit_teams, vit_players, vit_registration_codes, vit_registration_requests, vit_rate_limits, vit_admin_audit_logs, vit_norm_categories, vit_norms, vit_norm_blocks IN ACCESS EXCLUSIVE MODE");

    const target = await client.query('SELECT current_database() AS database, EXISTS (SELECT 1 FROM public."user" WHERE lower(email) = lower($1) AND role = \'admin\') AS admin_exists', [adminEmail]);
    if (target.rows[0]?.database !== (process.env.PGDATABASE || "neondb")) {
      throw new Error("Connected database does not match PGDATABASE; refusing to reset.");
    }
    if (!target.rows[0]?.admin_exists) {
      throw new Error("Configured ADMIN_EMAIL was not found as an admin; refusing to reset.");
    }

    await client.query(`TRUNCATE TABLE
      vit_players,
      vit_registration_requests,
      vit_registration_codes,
      vit_teams,
      vit_rate_limits,
      vit_admin_audit_logs,
      vit_norm_blocks,
      vit_norms,
      vit_norm_categories
      RESTART IDENTITY`);

    const category = await client.query(
      "INSERT INTO vit_norm_categories (slug, nombre, descripcion, orden, activa) VALUES ('reglamento', 'Reglamento', '', 0, true) RETURNING id",
    );
    await client.query(
      `INSERT INTO vit_norms (category_id, slug, titulo, resumen, publicado, orden, documento)
       VALUES ($1, 'normas-del-torneo', 'Normas del torneo', '', false, 0,
         '{\"type\":\"doc\",\"content\":[]}'::jsonb)`,
      [category.rows[0].id],
    );

    await client.query("COMMIT");
    console.log("Tournament data reset. Team, player, code, audit, rate-limit, and norms data cleared; blank norms sheet recreated. Auth users/sessions/accounts and schema were preserved.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function smokeRegistration() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slot = await client.query(`SELECT c.course, c.division FROM (VALUES
      ('1ro','A'),('1ro','B'),('1ro','C'),('2do','A'),('2do','B'),('2do','C'),('3ro','A'),('3ro','B'),('3ro','C'),
      ('4to','1ra'),('4to','2da'),('5to','1ra'),('5to','2da'),('6to','1ra'),('6to','2da'),('7mo','1ra'),('7mo','2da')
    ) AS c(course, division) WHERE (SELECT count(*) FROM vit_teams t JOIN vit_course_divisions d ON d.id=t.course_division_id WHERE d.curso_codigo=c.course AND d.codigo=c.division) < 2 LIMIT 1`);
    if (!slot.rowCount) throw new Error("No course/division has an available registration slot for the smoke check.");
    const code = `T${crypto.randomBytes(5).toString("hex")}`.slice(0, 6).toUpperCase();
    const requestId = crypto.randomUUID();
    const teamName = `SMOKECHECK${crypto.randomBytes(4).toString("hex")}`;
    await client.query("INSERT INTO vit_registration_codes(codigo) VALUES ($1)", [code]);
    const payload = {
      requestId, course: slot.rows[0].course, division: slot.rows[0].division, teamName,
      system: "6:0", systemType: null, color: "smoke test", phone: "1100000000", code,
      consent: true, starterCount: 6,
      players: Array.from({ length: 6 }, (_, index) => ({ name: `Smoke Player ${index + 1}` })),
    };
    const first = await client.query("SELECT register_vit_team($1::jsonb, $2) AS result", [JSON.stringify(payload), "db-smoke-check"]);
    if (!first.rows[0].result?.ok || first.rows[0].result?.duplicate) throw new Error("Initial registration did not return the expected result.");
    const retry = await client.query("SELECT register_vit_team($1::jsonb, $2) AS result", [JSON.stringify(payload), "db-smoke-check"]);
    if (!retry.rows[0].result?.ok || !retry.rows[0].result?.duplicate) throw new Error("Idempotent retry did not return the existing registration.");
    await client.query("ROLLBACK");
    console.log("Registration procedure passed; duplicate retry returned the original team; temporary rows rolled back.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const command = process.argv[2];
  if (command === "migrate") await migrate();
  else if (command === "check") await check();
  else if (command === "seed-demo") await seedDemo();
  else if (command === "cleanup-demo") await cleanupDemo();
  else if (command === "reset-norms") await resetNorms();
  else if (command === "reset-tournament-data") await resetTournamentData();
  else if (command === "smoke-registration") await smokeRegistration();
  else throw new Error("Usage: node scripts/vit-db.mjs <migrate|check|seed-demo|cleanup-demo|reset-norms|reset-tournament-data|smoke-registration>");
} catch (error) {
  console.error("Database operation failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
