import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

const bodySchema = z.object({ action: z.literal("cancel") }).strict();
const codeSchema = z.string().regex(/^[A-Z0-9]{6}$/);

export async function PATCH(request: Request, context: { params: Promise<{ code: string }> }) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
    const { code: rawCode } = await context.params;
    const code = codeSchema.safeParse(rawCode.toUpperCase());
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!code.success || !body.success) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    const sql = getSql();
    const rows = await sql`SELECT admin_update_vit_code(${code.data}, ${body.data.action}, ${process.env.ADMIN_EMAIL!.trim().toLowerCase()}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string; ok?: boolean } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Demasiados cambios. Probá de nuevo en un minuto." }, { status: 429 });
    if (!result?.ok) return NextResponse.json({ error: "El código no existe o ya tiene ese estado." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No pudimos actualizar el código." }, { status: 503 });
  }
}
