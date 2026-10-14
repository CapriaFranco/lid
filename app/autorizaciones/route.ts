import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pdfPath = resolve(process.cwd(), "public", "autorizaciones", "autorización-lid-2026.pdf");
    const pdf = await readFile(pdfPath);
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"autorizacion-lid-2026.pdf\"; filename*=UTF-8''autorizaci%C3%B3n-lid-2026.pdf",
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "El formulario de autorización no está disponible." }, { status: 404 });
  }
}
