import { NextResponse } from "next/server";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

export const dynamic = "force-dynamic";

async function snapshot(request: Request, backup: boolean) {
  if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (backup && !sameOrigin(request)) return NextResponse.json({ error: "Origen no válido." }, { status: 403 });
  const sql = getSql();
  const actor = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!actor) return NextResponse.json({ error: "Configuración administrativa incompleta." }, { status: 503 });
  const rows = await sql`SELECT vit_admin_system_snapshot(${await requestIdentity(request)}, ${actor}, ${backup}) AS result`;
  const result = rows[0]?.result as { error?: string; generated_at?: string; backup?: unknown } | undefined;
  if (result?.error === "rate_limited") return NextResponse.json({ error: "Esperá un momento antes de volver a consultar." }, { status: 429 });
  if (!result) return NextResponse.json({ error: "No hay datos del sistema disponibles." }, { status: 503 });
  return result;
}

export async function GET(request: Request) {
  try {
    const result = await snapshot(request, false);
    if (result instanceof Response) return result;
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos consultar el estado del sistema." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const result = await snapshot(request, true);
    if (result instanceof Response) return result;
    if (!result.backup) return NextResponse.json({ error: "No pudimos crear el respaldo." }, { status: 503 });
    const date = new Date(result.generated_at ?? Date.now()).toISOString().replace(/[:.]/g, "-");
    return new Response(JSON.stringify(result.backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="lid-backup-${date}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "No pudimos crear el respaldo." }, { status: 503 });
  }
}
