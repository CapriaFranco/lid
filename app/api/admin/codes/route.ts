import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

const schema = z.object({}).strict();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    const sql = getSql();
    const actor = process.env.ADMIN_EMAIL!.trim().toLowerCase();
    const candidates = Array.from({ length: 8 }, newCode);
    const rows = await sql`SELECT admin_generate_vit_codes(${JSON.stringify(candidates)}::jsonb, 1, ${actor}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string; codes?: string[] } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Demasiados cambios. Probá de nuevo en un minuto." }, { status: 429 });
    return NextResponse.json({ codes: result?.codes ?? [] }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos generar los códigos." }, { status: 503 });
  }
}
