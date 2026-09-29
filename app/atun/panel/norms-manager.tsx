import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { JSONContent } from "@tiptap/core";
import { BookOpenText, Copy, Download, FileUp, LoaderCircle, Save } from "lucide-react";
import NormDocumentEditor, { emptyNormDocument } from "./norm-document-editor";
import { normDocumentExchangeSchema } from "@/lib/norm-document-schema";

type Norm = { id: number; category_id: number; slug: string; titulo: string; resumen: string; publicado: boolean; documento: JSONContent };
type Category = { id: number; normas: Norm[] };
type EditingNorm = { id: number | null; category_id: number; slug: string; titulo: string; resumen: string; publicado: boolean; documento: JSONContent };

export default function NormsManager() {
  const [editing, setEditing] = useState<EditingNorm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const importFile = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/normas", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "No pudimos cargar el reglamento.");
    const categories: Category[] = result.categories ?? [];
    const category = categories[0];
    const norm = category?.normas[0];
    if (!category) {
      setEditing(null);
      return;
    }
    setEditing((current) => ({
      id: norm?.id ?? null,
      category_id: category.id,
      slug: norm?.slug ?? "normas-del-torneo",
      titulo: norm?.titulo ?? "Normas del torneo",
      resumen: norm?.resumen ?? "",
      publicado: norm?.publicado ?? false,
      documento: norm?.documento?.type === "doc" ? norm.documento : current?.documento ?? emptyNormDocument,
    }));
  }, []);

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Error al cargar.")); }, [load]);
  useEffect(() => { if (!message) return; const timeout = window.setTimeout(() => setMessage(""), 4500); return () => window.clearTimeout(timeout); }, [message]);

  async function saveNorm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/normas/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, categoryId: editing.category_id, slug: editing.slug, titulo: editing.titulo, resumen: editing.resumen, publicado: editing.publicado, documento: editing.documento }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo guardar el reglamento.");
      setMessage("Reglamento guardado.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el reglamento.");
    } finally {
      setBusy(false);
    }
  }

  function exportNorm() {
    if (!editing) return;
    const validated = normDocumentExchangeSchema.safeParse({
      format: "vit-normas-document",
      version: 1,
      title: editing.titulo,
      document: editing.documento,
    });
    if (!validated.success) {
      setMessage("El documento tiene un formato que no se puede exportar.");
      return;
    }
    const blob = new Blob([`${JSON.stringify(validated.data, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lid-normas-v1.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage("Documento exportado.");
  }

  async function importNorm(file?: File) {
    if (!file || !editing) return;
    if (file.size > 1_000_000) {
      setMessage("El archivo supera el límite de 1 MB.");
      if (importFile.current) importFile.current.value = "";
      return;
    }
    try {
      const parsedJson: unknown = JSON.parse(await file.text());
      const imported = normDocumentExchangeSchema.safeParse(parsedJson);
      if (!imported.success) throw new Error("El archivo no respeta el formato LID Normas v1.");
      if (!window.confirm("Importar reemplazará el contenido actual del documento. ¿Querés continuar?")) return;
      setEditing((current) => current ? { ...current, titulo: imported.data.title, documento: imported.data.document as JSONContent } : current);
      setMessage("Documento importado. Guardá los cambios para aplicarlos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo leer el archivo seleccionado.");
    } finally {
      if (importFile.current) importFile.current.value = "";
    }
  }

  async function copyGuide(resource: "prompt" | "skill") {
    try {
      const response = await fetch(`/api/atun/normas/recursos?resource=${resource}`, { cache: "no-store" });
      if (!response.ok) throw new Error("No pudimos cargar el texto para copiar.");
      await navigator.clipboard.writeText(await response.text());
      setMessage(resource === "prompt" ? "Prompt copiado." : "Skill copiada.");
    } catch {
      setMessage("No se pudo copiar. Revisá el permiso del portapapeles del navegador.");
    }
  }

  return <section className="admin-card admin-list-card norms-manager">
    <div className="admin-section-heading"><div><span className="admin-kicker">REGLAMENTO</span><h2>Editor de normas</h2></div><small>Una sola hoja</small></div>
    {message && <p className="admin-inline-message" role="status">{message}</p>}
    {!editing ? <div className="admin-empty"><BookOpenText size={19} /><p>La hoja del reglamento todavía no está inicializada. Ejecutá la limpieza inicial de Normas para crearla.</p></div> : <form className="norm-editor" onSubmit={saveNorm}>
      <aside className="norm-writing-guide" aria-label="Guía para redactar el reglamento">
        <strong>Guía editorial</strong>
        <p>Tomá V25 como referencia de orden y tono. Usá V26 como fuente de cambios y datos nuevos; no copies sus desajustes ni aceptes reescrituras externas como reglas aprobadas.</p>
        <ol>
          <li><b>Antes del torneo:</b> requisitos, inscripción y autorizaciones.</li>
          <li><b>Formato:</b> equipos, indumentaria, sistemas, sets y horarios.</li>
          <li><b>Durante el juego:</b> reglas técnicas y tiempos.</li>
          <li><b>Incumplimientos:</b> puntualidad, conducta y sanciones.</li>
        </ol>
        <p>Conservá cada condición y cifra aprobada. Si dos versiones se contradicen, señalá la diferencia para revisión; no inventes una resolución.</p>
        <p>Para importar, usá el prompt con los PDF y generá el JSON LID v1. Importar reemplaza el borrador; revisalo y pulsá <b>Guardar documento</b> para aplicarlo. El esquema por módulos sirve para ordenar la extracción, pero no es el formato JSON que acepta el editor.</p>
        <div className="norm-guide-actions" aria-label="Prompt y skill de Normas LID">
          <button type="button" className="norm-exchange-button" onClick={() => void copyGuide("prompt")}><Copy size={13} /> Copiar prompt</button>
          <a className="norm-exchange-button" href="/api/atun/normas/recursos?resource=prompt&download=1"><Download size={13} /> Descargar prompt</a>
          <button type="button" className="norm-exchange-button" onClick={() => void copyGuide("skill")}><Copy size={13} /> Copiar skill</button>
          <a className="norm-exchange-button" href="/api/atun/normas/recursos?resource=skill&download=1"><Download size={13} /> Descargar skill</a>
        </div>
      </aside>
      <div className="norm-editor-head"><div><span className="admin-kicker">DOCUMENTO ÚNICO</span><h3>Normas del torneo</h3></div><label className="norm-publish"><input type="checkbox" checked={editing.publicado} onChange={(event) => setEditing({ ...editing, publicado: event.target.checked })} /> Publicar en el sitio</label></div>
      <NormDocumentEditor key={editing.id ?? "normas-del-torneo"} value={editing.documento} onChange={(documento) => setEditing((current) => current ? { ...current, documento } : current)} />
      <div className="norm-editor-actions">
        <div className="norm-exchange-actions">
          <input ref={importFile} type="file" accept="application/json,.json" hidden onChange={(event) => void importNorm(event.target.files?.[0])} />
          <button type="button" className="norm-exchange-button" onClick={() => importFile.current?.click()}><FileUp size={14} /> Importar JSON</button>
          <button type="button" className="norm-exchange-button" onClick={exportNorm}><Download size={14} /> Exportar JSON</button>
        </div>
        <button type="submit" className="admin-primary compact" disabled={busy}>{busy ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} Guardar documento</button>
      </div>
    </form>}
  </section>;
}
