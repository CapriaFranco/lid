import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

const person = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/u;
const teamPattern = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]+$/u;
const courses = ["1ro", "2do", "3ro", "4to", "5to", "6to", "7mo"] as const;
const positions = ["Punta", "Opuesto", "Central", "Armador", "Libero"] as const;
const schema = z.object({
  requestId: z.string().uuid(),
  course: z.enum(courses),
  division: z.string(),
  teamName: z.string().trim().min(3).max(60).regex(teamPattern),
  system: z.enum(["6:0", "4:2", "5:1"]),
  systemType: z.enum(["c", "o"]).optional(),
  players: z.array(z.object({ name: z.string().trim().min(3).max(64).regex(person), position: z.enum(positions).optional() })).min(6).max(8),
  color: z.string().trim().min(2).max(32).regex(person),
  phone: z.string().regex(/^\d{8,15}$/),
  code: z.string().regex(/^[A-Za-z0-9]{6}$/),
  consent: z.literal(true),
});

function allowedPositions(system: string, type?: string): string[] {
  if (system === "6:0") return [];
  if (system === "5:1") return ["Armador", "Opuesto", "Libero", "Central", "Central", "Punta", "Punta"];
  return type === "o" ? ["Armador", "Armador", "Opuesto", "Opuesto", "Punta", "Punta"] : ["Armador", "Armador", "Central", "Central", "Punta", "Punta", "Libero"];
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")));
    const error = fields.has("code") ? "El código debe tener seis letras o números."
      : fields.has("requestId") ? "La solicitud no es válida. Actualizá la página e intentá de nuevo."
      : fields.has("players") ? "Revisá los nombres y las posiciones requeridas para el sistema elegido."
      : fields.has("color") ? "El color debe contener solo letras y espacios."
      : fields.has("teamName") ? "El nombre del equipo debe tener al menos tres caracteres y solo letras, números y espacios."
      : "Revisá los datos del formulario.";
    return NextResponse.json({ error }, { status: 400 });
  }
  const data = parsed.data;
  if (request.headers.get("idempotency-key") !== data.requestId) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  const divisions = ["1ro", "2do", "3ro"].includes(data.course) ? ["A", "B", "C"] : ["1ra", "2da"];
  if (!divisions.includes(data.division)) return NextResponse.json({ error: "La división no corresponde al curso." }, { status: 400 });
  if ((data.system === "4:2") !== Boolean(data.systemType)) return NextResponse.json({ error: "Elegí un tipo válido para el sistema 4:2." }, { status: 400 });
  const starterCount = data.system === "5:1" || (data.system === "4:2" && data.systemType === "c") ? 7 : 6;
  if (data.players.length < starterCount) return NextResponse.json({ error: `Este sistema requiere ${starterCount} titulares.` }, { status: 400 });
  if (data.system === "6:0" && data.players.some((player) => player.position)) return NextResponse.json({ error: "El sistema 6:0 no lleva posiciones." }, { status: 400 });
  const expected = allowedPositions(data.system, data.systemType);
  if (data.system !== "6:0") {
    const submitted = data.players.slice(0, starterCount).map((player) => player.position ?? "").sort();
    if (submitted.includes("") || JSON.stringify(submitted) !== JSON.stringify(expected.slice(0, starterCount).sort())) return NextResponse.json({ error: "Revisá las posiciones de los titulares." }, { status: 400 });
  }
  try {
    const sql = getSql();
    const payload = { ...data, code: data.code.toUpperCase(), starterCount };
    const rows = await sql`SELECT register_vit_team(${JSON.stringify(payload)}::jsonb, ${await requestIdentity(request)}) AS result`;
    const result = rows[0].result as { ok: boolean; reason?: string; duplicate?: boolean };
    if (!result.ok) {
      if (result.reason === "rate_limited") return NextResponse.json({ error: "Alcanzaste el límite de envíos. Esperá un minuto antes de volver a intentar." }, { status: 429 });
      const errors: Record<string, string> = { capacity: "Esta división ya completó sus dos cupos.", duplicate_name: "Ya existe un equipo con ese nombre.", invalid_code: "El código es inválido o ya fue utilizado.", invalid_division: "La división no corresponde al curso." };
      return NextResponse.json({ error: errors[result.reason ?? ""] ?? "No se pudo completar el registro." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: "No pudimos completar el registro. Reintentá en unos minutos." }, { status: 503 });
  }
}
