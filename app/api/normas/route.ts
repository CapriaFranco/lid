import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`SELECT vit_public_norms() AS result`;
    const categories = rows[0]?.result ?? [];
    return NextResponse.json({ categories }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar las normas." }, { status: 503 });
  }
}
