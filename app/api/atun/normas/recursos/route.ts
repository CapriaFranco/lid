import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const resources = {
  prompt: {
    file: ".agents/skills/vit-normas/references/reestructurar-reglamento.prompt.md",
    download: "prompt-reestructurar-normas-lid.md",
  },
  skill: {
    file: ".agents/skills/vit-normas/SKILL.md",
    download: "skill-normas-lid.md",
  },
} as const;

export async function GET(request: Request) {
  if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const resourceName = new URL(request.url).searchParams.get("resource") as keyof typeof resources | null;
  if (!resourceName || !(resourceName in resources)) return NextResponse.json({ error: "Recurso no disponible." }, { status: 404 });

  try {
    const resource = resources[resourceName];
    const content = await readFile(resolve(process.cwd(), resource.file), "utf8");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(content, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/markdown; charset=utf-8",
        ...(download ? { "Content-Disposition": `attachment; filename="${resource.download}"` } : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "No pudimos cargar el recurso." }, { status: 503 });
  }
}
