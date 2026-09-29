import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const sql = getSql();
    const rows = await sql`SELECT vit_admin_dashboard(${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Esperá un momento antes de volver a consultar." }, { status: 429 });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar los datos del panel." }, { status: 503 });
  }
}
