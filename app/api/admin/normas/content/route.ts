import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";
import { hasNormDocumentContent, normDocumentSchema } from "@/lib/norm-document-schema";

export const dynamic = "force-dynamic";

const documentSchema = normDocumentSchema;
const schema = z.object({
  id: z.number().int().positive().nullable().default(null),
  categoryId: z.number().int().positive(),
  slug: z.string().trim().min(1).max(64),
  titulo: z.string().trim().min(2).max(120),
  resumen: z.string().trim().max(300).default(""),
  publicado: z.boolean().default(false),
  documento: documentSchema,
}).strict();

export async function POST(request: Request) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Revisá el documento y los estilos permitidos." }, { status: 400 });
    const { id, categoryId, slug, titulo, resumen, publicado, documento } = parsed.data;
    if (publicado && !hasNormDocumentContent(documento)) {
      return NextResponse.json({ error: "Agregá contenido al reglamento antes de publicarlo." }, { status: 400 });
    }
    const normalizedSlug = slug.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
    const sql = getSql();
    const rows = await sql`SELECT admin_save_vit_norm(${id}, ${categoryId}, ${normalizedSlug}, ${titulo}, ${resumen}, ${publicado}, ${JSON.stringify(documento)}::jsonb, ${process.env.ADMIN_EMAIL!.trim().toLowerCase()}, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string; ok?: boolean; id?: number } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Demasiadas operaciones. Probá de nuevo en un minuto." }, { status: 429 });
    if (result?.error === "duplicate_slug") return NextResponse.json({ error: "Ya existe una norma con ese identificador." }, { status: 409 });
    if (result?.error === "invalid_category") return NextResponse.json({ error: "Elegí una categoría válida." }, { status: 400 });
    if (result?.error === "invalid_document") return NextResponse.json({ error: "El documento contiene un formato no permitido." }, { status: 400 });
    if (result?.error === "not_found") return NextResponse.json({ error: "La norma ya no existe. Actualizá la lista." }, { status: 404 });
    if (!result?.ok) return NextResponse.json({ error: "No pudimos guardar el documento. Revisá sus datos." }, { status: 400 });
    return NextResponse.json({ ok: true, id: result.id }, { status: id ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No pudimos guardar el documento." }, { status: 503 });
  }
}
