import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

const schema = z.object({ name: z.string().trim().min(3).max(60) });
export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ingresá al menos 3 caracteres." }, { status: 400 });
  try {
    const sql = getSql();
    const rows = await sql`SELECT vit_check_team_name(${parsed.data.name}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Esperá un momento antes de volver a consultar." }, { status: 429 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos validar el nombre. Reintentá." }, { status: 503 });
  }
}
