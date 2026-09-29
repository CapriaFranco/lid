import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin, sameOrigin } from "@/lib/admin";
import { getSql } from "@/lib/db";
import { requestIdentity } from "@/lib/registration";

const courses = ["1ro", "2do", "3ro", "4to", "5to", "6to", "7mo"] as const;
const positions = ["Punta", "Opuesto", "Central", "Armador", "Libero"] as const;
const teamFields = {
  curso: z.enum(courses),
  division: z.enum(["A", "B", "C", "1ra", "2da"]),
  nombre: z.string().trim().min(3).max(60).regex(/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]+$/u),
  sistema: z.enum(["6:0", "4:2", "5:1"]),
  tipo: z.enum(["c", "o"]).nullable(),
  color: z.string().trim().min(2).max(32).regex(/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]+$/u),
  telefono: z.string().regex(/^\d{8,15}$/),
  justificacion_admin: z.string().trim().max(300),
};
const playerFields = {
  nombre: z.string().trim().min(3).max(64).regex(/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/u),
  posicion: z.enum(positions).nullable(),
  suplente: z.boolean(),
  autorizacion: z.boolean(),
};
const nonEmpty = <T extends z.ZodType>(schema: T) => schema.refine((value) => Object.keys(value as object).length > 0, "Debe contener al menos un cambio.");
const teamPatchSchema = nonEmpty(z.object(teamFields).partial().strict());
const playerPatchSchema = nonEmpty(z.object({ ...playerFields, orden: z.number().int().min(0).max(8).optional() }).partial().strict());
const changesSchema = z.object({
  team: teamPatchSchema.optional(),
  players: z.object({
    update: z.array(z.object({ id: z.number().int().positive(), changes: playerPatchSchema }).strict()).max(9).optional(),
    add: z.array(z.object({ ...playerFields, orden: z.number().int().min(0).max(8) }).strict()).max(9).optional(),
    deleteIds: z.array(z.number().int().positive()).max(9).optional(),
  }).strict()
    .refine((value) => Boolean(value.update?.length || value.add?.length || value.deleteIds?.length), "Debe contener cambios de integrantes.")
    .refine((value) => {
      const updateIds = value.update?.map((item) => item.id) ?? [];
      const deleteIds = value.deleteIds ?? [];
      return new Set(updateIds).size === updateIds.length && new Set(deleteIds).size === deleteIds.length && !deleteIds.some((id) => updateIds.includes(id));
    }, "No se puede modificar el mismo integrante más de una vez.").optional(),
}).strict().refine((value) => Boolean(value.team || value.players), "No hay cambios para guardar.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!await isAdmin(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!sameOrigin(request)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 403 });
    const { id: rawId } = await context.params;
    if (!/^\d{1,15}$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) return NextResponse.json({ error: "Equipo inválido." }, { status: 400 });

    const parsed = changesSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path.join(".") ?? "";
      const error = field.includes("autorizacion") ? "La autorización seleccionada no es válida."
        : field.includes("posicion") ? "La posición seleccionada no es válida para este cambio."
        : field.includes("nombre") ? "Revisá el nombre que modificaste."
        : field.includes("telefono") ? "El teléfono debe tener entre 8 y 15 números."
        : "Revisá los campos que modificaste.";
      return NextResponse.json({ error }, { status: 400 });
    }

    const changes = parsed.data;
    if (changes.team?.curso && changes.team.division) {
      const basic = ["1ro", "2do", "3ro"].includes(changes.team.curso);
      if ((basic && !["A", "B", "C"].includes(changes.team.division)) || (!basic && !["1ra", "2da"].includes(changes.team.division))) {
        return NextResponse.json({ error: "La división no corresponde al curso." }, { status: 400 });
      }
    }

    const sql = getSql();
    const rows = await sql`SELECT admin_patch_vit_team(${Number(rawId)}, ${process.env.ADMIN_EMAIL!.trim().toLowerCase()}, ${JSON.stringify(changes)}::jsonb, ${await requestIdentity(request)}) AS result`;
    const result = rows[0]?.result as { error?: string; ok?: boolean; reason?: string } | undefined;
    if (result?.error === "rate_limited") return NextResponse.json({ error: "Demasiados cambios. Probá de nuevo en un minuto." }, { status: 429 });
    if (!result?.ok && result?.reason === "duplicate_name") return NextResponse.json({ error: "Ya existe otro equipo con ese nombre." }, { status: 409 });
    if (!result?.ok && result?.reason === "not_found") return NextResponse.json({ error: "El equipo ya no está disponible." }, { status: 404 });
    if (!result?.ok && result?.reason === "not_found_player") return NextResponse.json({ error: "Un integrante cambió desde que abriste el editor. Actualizá el panel e intentá de nuevo." }, { status: 409 });
    if (!result?.ok && result?.reason === "invalid_roster") return NextResponse.json({ error: "El equipo debe tener entre 6 y 9 integrantes." }, { status: 400 });
    if (!result?.ok && result?.reason === "ninth_player_justification") return NextResponse.json({ error: "El noveno integrante requiere una justificación de al menos 8 caracteres." }, { status: 400 });
    if (!result?.ok && result?.reason === "invalid_system_type") return NextResponse.json({ error: "Revisá el sistema y su variante 4:2." }, { status: 400 });
    if (!result?.ok) return NextResponse.json({ error: "No se pudieron aplicar los cambios seleccionados." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No pudimos guardar los cambios del equipo." }, { status: 503 });
  }
}
