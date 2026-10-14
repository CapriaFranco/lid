import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

export const dynamic = "force-dynamic";

const schema = z.object({
  course: z.enum(["1ro", "2do", "3ro", "4to", "5to", "6to", "7mo"]),
  division: z.enum(["A", "B", "C", "1ra", "2da"]).nullable(),
  limit: z.number().int().min(2).max(5).nullable(),
}).strict().refine((value) => value.limit === null || value.limit >= 2);

export async function GET(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const sql = getSql();
    const rows = await sql`SELECT vit_admin_capacity_settings(${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Esperá un momento y volvé a consultar." }, { status: 429 });
    return NextResponse.json(result ?? { rules: [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos consultar las excepciones de cupo." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Elegí un curso, una división válida y un límite entre 2 y 5." }, { status: 400 });
    const actor = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (!actor) return NextResponse.json({ error: "Configuración administrativa incompleta." }, { status: 503 });
    const sql = getSql();
    const { course, division, limit } = parsed.data;
    const rows = await sql`SELECT vit_admin_set_capacity_override(${course}, ${division}, ${limit}, ${actor}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string; ok?: boolean; reason?: string } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Demasiados cambios. Esperá un minuto." }, { status: 429 });
    if (result?.reason === "invalid_division" || result?.reason === "invalid_course") return NextResponse.json({ error: "La división no corresponde al curso." }, { status: 400 });
    if (result?.reason === "invalid_limit") return NextResponse.json({ error: "El límite permitido es de 2 a 5 equipos." }, { status: 400 });
    if (!result?.ok) return NextResponse.json({ error: "No pudimos guardar la excepción." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No pudimos guardar la excepción de cupo." }, { status: 503 });
  }
}
