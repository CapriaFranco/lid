import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

const querySchema = z.object({ cycle: z.enum(["basico", "superior", "ambos"]) });
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ cycle: request.nextUrl.searchParams.get("cycle") });
  if (!parsed.success) return NextResponse.json({ error: "Ciclo inválido." }, { status: 400 });
  try {
    const sql = getSql();
    const rows = await sql`SELECT vit_public_teams(${parsed.data.cycle}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Esperá un momento antes de volver a consultar." }, { status: 429 });
    if (result?.error === "invalid_cycle") return NextResponse.json({ error: "Ciclo inválido." }, { status: 400 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar los equipos en este momento." }, { status: 503 });
  }
}
