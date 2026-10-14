"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plus, RotateCcw, X } from "lucide-react";

type Rule = { course: string; division: string | null; limit: number; updated_at: string };
type Slot = { course: string; division: string; active: number; limit: number; source: "division" | "course" | "default" };
const courses = ["1ro", "2do", "3ro", "4to", "5to", "6to", "7mo"];

export default function CapacitySettings() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [course, setCourse] = useState(courses[0]);
  const [division, setDivision] = useState("");
  const [limit, setLimit] = useState("3");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const divisions = ["1ro", "2do", "3ro"].includes(course) ? ["A", "B", "C"] : ["1ra", "2da"];
  const selectedRule = rules.find((rule) => rule.course === course && rule.division === (division || null));
  const selectedSlot = slots.find((slot) => slot.course === course && slot.division === division);
  const selectedCurrentLimit = selectedRule?.limit ?? selectedSlot?.limit ?? 2;

  useEffect(() => { setLimit(String(selectedCurrentLimit)); }, [course, division, selectedCurrentLimit]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/settings/capacity", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos cargar las excepciones.");
      setRules(result.rules ?? []);
      setSlots(result.slots ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos cargar las excepciones."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("lid:capacity-refresh", refresh);
    return () => window.removeEventListener("lid:capacity-refresh", refresh);
  }, [load]);

  async function saveRule(next: { course: string; division: string | null; limit: number | null }) {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/settings/capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos guardar la excepción.");
      await load();
      setMessage(next.limit === null ? "Se quitó la excepción; se aplica el límite heredado." : "Se guardó el nuevo límite de equipos.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar la excepción."); }
    finally { setSaving(false); }
  }

  return <section className="admin-card capacity-settings">
    <div className="admin-section-heading"><div><span className="admin-kicker">INSCRIPCIONES</span><h2>Excepciones de cupo</h2></div><small>Base: 2 · máximo: 5</small></div>
    <p className="capacity-description">Aumentá el cupo para un curso completo o para una división puntual. Si existen ambas reglas, prevalece la división. El cambio se valida también al registrar el equipo.</p>
    <form className="capacity-form" onSubmit={(event) => { event.preventDefault(); void saveRule({ course, division: division || null, limit: Number(limit) }); }}>
      <label className="admin-field"><span>Curso</span><select value={course} onChange={(event) => { setCourse(event.target.value); setDivision(""); }}>
        {courses.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label className="admin-field"><span>Alcance</span><select value={division} onChange={(event) => setDivision(event.target.value)}>
        <option value="">Todo el curso</option>{divisions.map((item) => <option key={item} value={item}>Solo {item}</option>)}
      </select></label>
      <label className="admin-field"><span>Equipos permitidos</span><select value={limit} onChange={(event) => setLimit(event.target.value)}>
        {[2, 3, 4, 5].map((item) => <option key={item} value={item}>{item} equipos</option>)}
      </select></label>
      <div className="capacity-form-actions"><small>Actual: {selectedCurrentLimit} equipos</small><button className="admin-primary compact" type="submit" disabled={saving}><Plus size={14} /> Guardar límite</button>{selectedRule && <button type="button" className="capacity-inherit" disabled={saving} onClick={() => void saveRule({ course, division: division || null, limit: null })} aria-label="Quitar excepción seleccionada" title="Volver al límite heredado">{saving ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}</button>}</div>
    </form>
    {(error || message) && <p className={`capacity-feedback ${error ? "is-error" : ""}`} role="status">{error || message}</p>}
    {loading ? <div className="admin-state"><LoaderCircle className="spin" size={16} /> Cargando límites…</div> : <>
      <div className="capacity-slot-list" role="table" aria-label="Cupos por curso y división">
        <div className="capacity-slot-head" role="row"><span>Curso</span><span>División</span><span>Equipos activos</span><span>Cupo permitido</span></div>
        {slots.map((slot) => <div className="capacity-slot-row" role="row" key={`${slot.course}-${slot.division}`}>
          <strong>{slot.course}</strong><span>{slot.division}</span><span>{slot.active} / {slot.limit}</span>
          <div><select aria-label={`Cupo permitido para ${slot.course} ${slot.division}`} value={slot.limit} disabled={saving} onChange={(event) => void saveRule({ course: slot.course, division: slot.division, limit: Number(event.target.value) })}>
            {[2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} equipos</option>)}
          </select><small>{slot.source === "division" ? "Excepción propia" : slot.source === "course" ? "Hereda del curso" : "Límite general"}</small>
          {slot.source === "division" && <button type="button" className="capacity-inherit" disabled={saving} onClick={() => void saveRule({ course: slot.course, division: slot.division, limit: null })} aria-label={`Heredar cupo para ${slot.course} ${slot.division}`} title="Volver al límite del curso"><RotateCcw size={13} /></button>}</div>
        </div>)}
      </div>
      {!rules.length && <p className="capacity-empty"><X size={14} /> No hay excepciones configuradas. Los 17 cursos/divisiones usan el límite general de 2.</p>}
    </>}
  </section>;
}
