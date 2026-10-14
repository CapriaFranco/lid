import { NextResponse } from "next/server";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
    const { id } = await context.params;
    if (!/^\d{1,15}$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "Equipo inválido." }, { status: 400 });
    const actor = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (!actor) return NextResponse.json({ error: "Configuración administrativa incompleta." }, { status: 503 });
    const sql = getSql();
    const rows = await sql`SELECT admin_restore_vit_team(${Number(id)}, ${actor}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string; ok?: boolean; reason?: string; capacityExceeded?: boolean; activeCount?: number; limit?: number } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Demasiados cambios. Probá de nuevo en un minuto." }, { status: 429 });
    if (result?.reason === "not_found") return NextResponse.json({ error: "El equipo archivado ya no está disponible." }, { status: 404 });
    if (result?.reason === "duplicate_name") return NextResponse.json({ error: "Ya existe un equipo activo con ese nombre." }, { status: 409 });
    if (!result?.ok) return NextResponse.json({ error: "No pudimos recuperar el equipo." }, { status: 400 });
    return NextResponse.json({ ok: true, capacityExceeded: result.capacityExceeded === true, activeCount: result.activeCount, limit: result.limit });
  } catch { return NextResponse.json({ error: "No pudimos recuperar el equipo." }, { status: 503 }); }
}
