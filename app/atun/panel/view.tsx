"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowDown, ArrowUp, Archive, Check, Copy, Database, Download, FileText, KeyRound, LoaderCircle, LogOut, Pencil, Plus, RefreshCw, RotateCcw, Save, ShieldCheck, ShieldX, SlidersHorizontal, UsersRound, X } from "lucide-react";
import { createAuthClient } from "better-auth/react";
import NormsManager from "./norms-manager";
import CapacitySettings from "./capacity-settings";

interface Player { id?: number; uiKey?: string; nombre: string; posicion: string | null; suplente: boolean; autorizacion: boolean }
interface Team { id: number; nombre: string; curso: string; division: string; sistema: string; tipo: string | null; color: string; capitan: string; telefono: string; justificacion_admin: string; fecha_registro: string; deleted_at: string | null; integrantes: Player[] }
interface RegistrationCode { codigo: string; usado: boolean; cancelado: boolean; fecha_creacion: string; id_equipo: number | null; equipo: string | null; curso: string | null; division: string | null }
type Section = "equipos" | "codigos" | "normas" | "cupos" | "sistema";
interface AuditEntry { actor_email: string; action: string; entity_type: string; entity_id: string; details: Record<string, unknown>; created_at: string }
interface SystemOverview { database: string; generated_at: string; database_size_bytes: number; counts: Record<string, number>; table_sizes: Array<{ name: string; bytes: number }>; audit: AuditEntry[] }

const client = createAuthClient();
const courses = ["1ro", "2do", "3ro", "4to", "5to", "6to", "7mo"];
const rosterMinimum = (system: string, type: string | null) => system === "5:1" || (system === "4:2" && type === "c") ? 7 : 6;
const positionSlots = (system: string, type: string | null) => system === "4:2"
  ? type === "o" ? ["Armador", "Armador", "Opuesto", "Opuesto", "Punta", "Punta"] : ["Armador", "Armador", "Central", "Central", "Punta", "Punta", "Libero"]
  : system === "5:1" ? ["Armador", "Opuesto", "Libero", "Central", "Central", "Punta", "Punta"] : [];
const normalizeRoster = (players: Player[], minimum: number) => players.map((player, index) => ({ ...player, suplente: index >= minimum }));
const availablePositions = (players: Player[], index: number, system: string, type: string | null) => {
  const slots = positionSlots(system, type);
  const current = players[index]?.posicion;
  return [...new Set(slots)].filter((position) => current === position || players.filter((player, playerIndex) => playerIndex !== index && player.posicion === position).length < slots.filter((slot) => slot === position).length);
};
const emptyData = { teams: [] as Team[], codes: [] as RegistrationCode[] };
const auditLabels: Record<string, string> = {
  "team.update": "Equipo actualizado", "team.soft_delete": "Equipo archivado", "team.restore": "Equipo recuperado",
  "codes.generate": "Códigos generados", "code.cancel": "Código cancelado", "code.mark-used": "Código marcado como usado",
  "capacity.override_saved": "Límite de cupo actualizado", "capacity.override_removed": "Excepción de cupo quitada",
  "system.backup": "Respaldo descargado", "norm.save": "Norma actualizada", "norm.update": "Norma actualizada",
};
const auditFieldLabels: Record<string, string> = {
  nombre: "nombre", curso: "curso", division: "división", sistema: "sistema de juego", tipo: "variante 4:2",
  color: "color", telefono: "teléfono", justificacion_admin: "justificación", integrantes: "integrantes",
};
const auditDetailLabels: Record<string, string> = {
  team_fields: "Datos del equipo modificados", players_updated: "Integrantes editados", players_added: "Integrantes agregados",
  players_deleted: "Integrantes quitados", nombre: "Equipo", deleted_at: "Fecha de archivo", capacity_released: "Cupo liberado",
  capacity_claimed: "Cupo ocupado", limit: "Nuevo límite", scope: "Alcance", count: "Códigos generados", format: "Formato",
  slug: "Identificador de la norma", published: "Publicada", document_bytes: "Tamaño del documento",
};
function auditDetailValue(key: string, value: unknown) {
  if (key === "team_fields" && Array.isArray(value)) return value.map((field) => auditFieldLabels[String(field)] ?? String(field)).join(", ");
  if (key === "scope") return value === "course" ? "Curso completo" : value === "division" ? "División" : String(value);
  if (key === "deleted_at" && typeof value === "string") return new Date(value).toLocaleString("es-AR");
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : String(value);
}
function auditSummary(entry: AuditEntry) {
  const details = entry.details ?? {};
  if (entry.action === "team.update") {
    const fields = Array.isArray(details.team_fields) ? details.team_fields.map((field) => auditFieldLabels[String(field)] ?? String(field)) : [];
    const playerChanges = [
      Number(details.players_updated) ? `${details.players_updated} integrante(s) editados` : "",
      Number(details.players_added) ? `${details.players_added} agregado(s)` : "",
      Number(details.players_deleted) ? `${details.players_deleted} quitado(s)` : "",
    ].filter(Boolean);
    return [fields.length ? `Campos: ${fields.join(", ")}` : "Datos del equipo", ...playerChanges].join(" · ");
  }
  if (entry.action === "team.soft_delete") return `${String(details.nombre ?? "Equipo")} · se liberó un cupo`;
  if (entry.action === "team.restore") return `${String(details.nombre ?? "Equipo")} · volvió a ocupar un cupo`;
  if (entry.action.startsWith("capacity.")) return `${entry.entity_id.replace(":", " · ")} · ${details.limit ? `${details.limit} equipos` : "usa el límite heredado"}`;
  if (entry.action === "codes.generate") return `${details.count ?? 0} código(s)`;
  if (entry.action === "norm.update") return `${details.slug ?? "Norma"} · ${details.published ? "publicada" : "sin publicar"} · documento ${details.document_bytes ?? 0} bytes`;
  if (entry.action.startsWith("code.")) return `Código ${entry.entity_id}`;
  if (entry.action === "system.backup") return "Se descargó una copia de la información del torneo";
  return Object.entries(details).map(([key, value]) => `${auditFieldLabels[key] ?? key}: ${typeof value === "string" ? value : JSON.stringify(value)}`).join(" · ") || `${entry.entity_type} ${entry.entity_id}`;
}

function diffTeam(original: Team, current: Team) {
  const team: Record<string, unknown> = {};
  for (const field of ["curso", "division", "nombre", "sistema", "tipo", "color", "telefono", "justificacion_admin"] as const) {
    if (original[field] !== current[field]) team[field] = current[field];
  }
  const originalById = new Map(original.integrantes.flatMap((player, index) => player.id ? [[player.id, { player, index }] as const] : []));
  const currentIds = new Set(current.integrantes.flatMap((player) => player.id ? [player.id] : []));
  const update: Array<{ id: number; changes: Record<string, unknown> }> = [];
  const add: Array<{ nombre: string; posicion: string | null; suplente: boolean; autorizacion: boolean; orden: number }> = [];
  current.integrantes.forEach((player, index) => {
    if (!player.id) {
      add.push({ nombre: player.nombre, posicion: current.sistema === "6:0" ? null : player.posicion, suplente: player.suplente, autorizacion: player.autorizacion, orden: index });
      return;
    }
    const before = originalById.get(player.id);
    if (!before) return;
    const changes: Record<string, unknown> = {};
    for (const field of ["nombre", "posicion", "suplente", "autorizacion"] as const) {
      const nextValue = field === "posicion" && current.sistema === "6:0" ? null : player[field];
      if (before.player[field] !== nextValue) changes[field] = nextValue;
    }
    if (before.index !== index) changes.orden = index;
    if (Object.keys(changes).length) update.push({ id: player.id, changes });
  });
  const deleteIds = original.integrantes.flatMap((player) => player.id && !currentIds.has(player.id) ? [player.id] : []);
  const players = update.length || add.length || deleteIds.length ? { update, add, deleteIds } : undefined;
  return { ...(Object.keys(team).length ? { team } : {}), ...(players ? { players } : {}) };
}

export default function AdminDashboard({ email }: { email: string }) {
  const [section, setSection] = useState<Section>("equipos");
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<string[]>([]);
  const [editing, setEditing] = useState<Team | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [teamView, setTeamView] = useState<"active" | "archived">("active");
  const [teamActionConfirm, setTeamActionConfirm] = useState<number | null>(null);
  const [teamActionBusy, setTeamActionBusy] = useState<number | null>(null);
  const [systemOverview, setSystemOverview] = useState<SystemOverview | null>(null);
  const [systemLoading, setSystemLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupConfirming, setBackupConfirming] = useState(false);
  const [systemError, setSystemError] = useState("");
  const rosterContext = useRef<{ teamId: number; system: string; type: string | null } | null>(null);
  const originalEditing = useRef<Team | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/data", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos cargar el panel.");
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos cargar el panel.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const loadSystem = useCallback(async () => {
    setSystemLoading(true); setSystemError("");
    try {
      const response = await fetch("/api/admin/system", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos cargar el resumen del sistema.");
      setSystemOverview(result);
    } catch (cause) {
      setSystemError(cause instanceof Error ? cause.message : "No pudimos cargar el resumen del sistema.");
    } finally { setSystemLoading(false); }
  }, []);
  useEffect(() => { if (section === "sistema") void loadSystem(); }, [section, loadSystem]);
  const editingTeamId = editing?.id;
  const editingSystem = editing?.sistema;
  const editingSystemType = editing?.tipo;
  useEffect(() => {
    if (editingTeamId === undefined || editingSystem === undefined) { rosterContext.current = null; return; }
    const previous = rosterContext.current;
    rosterContext.current = { teamId: editingTeamId, system: editingSystem, type: editingSystemType ?? null };
    if (!previous || previous.teamId !== editingTeamId || (previous.system === editingSystem && previous.type === editingSystemType)) return;
    setPositionFilter("");
    setEditing((current) => current?.id === editingTeamId
      ? { ...current, integrantes: normalizeRoster(current.integrantes.map((player) => ({ ...player, posicion: null })), rosterMinimum(current.sistema, current.tipo)) }
      : current);
  }, [editingTeamId, editingSystem, editingSystemType]);
  useEffect(() => {
    if (!message && !error) return;
    const timeout = window.setTimeout(() => { setMessage(""); setError(""); }, 4500);
    return () => window.clearTimeout(timeout);
  }, [message, error]);
  const activeTeams = useMemo(() => data.teams.filter((team) => !team.deleted_at), [data.teams]);
  const archivedTeams = useMemo(() => data.teams.filter((team) => Boolean(team.deleted_at)), [data.teams]);
  const visibleTeams = teamView === "active" ? activeTeams : archivedTeams;
  const participants = useMemo(() => activeTeams.reduce((total, team) => total + team.integrantes.length, 0), [activeTeams]);

  async function teamAction(team: Team, action: "archive" | "restore") {
    if (action === "archive" && teamActionConfirm !== team.id) { setTeamActionConfirm(team.id); return; }
    setTeamActionBusy(team.id); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/teams/${team.id}${action === "restore" ? "/restore" : ""}`, { method: action === "restore" ? "POST" : "DELETE", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos actualizar el equipo.");
      setTeamActionConfirm(null);
      setMessage(action === "archive" ? `Se archivó ${team.nombre} y se liberó su cupo.` : result.capacityExceeded
        ? `Se recuperó ${team.nombre}. La división queda por encima del cupo (${result.activeCount}/${result.limit}); no se admitirán nuevos equipos hasta liberar una plaza.`
        : `Se recuperó ${team.nombre}.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos actualizar el equipo."); }
    finally { setTeamActionBusy(null); }
  }

  async function generateCodes() {
    setBusy("generate"); setMessage("");
    try {
      const response = await fetch("/api/admin/codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos generar los códigos.");
      const createdAt = new Date().toISOString();
      const newCodes: RegistrationCode[] = result.codes.map((codigo: string) => ({ codigo, usado: false, cancelado: false, fecha_creacion: createdAt, id_equipo: null, equipo: null, curso: null, division: null }));
      setGenerated(result.codes);
      setData((current) => ({ ...current, codes: [...newCodes, ...current.codes].slice(0, 300) }));
      setMessage("Se generó un código nuevo.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos generar los códigos."); }
    finally { setBusy(""); }
  }

  async function codeAction(code: string) {
    setBusy(code); setMessage(""); setError("");
    try {
      const response = await fetch(`/api/admin/codes/${encodeURIComponent(code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos actualizar el código.");
      setData((current) => ({ ...current, codes: current.codes.map((entry) => entry.codigo === code ? { ...entry, usado: true, cancelado: true } : entry) }));
      setMessage(`Código ${code} cancelado.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos actualizar el código."); }
    finally { setBusy(""); }
  }

  async function saveTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !originalEditing.current) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const payload = diffTeam(originalEditing.current, editing);
      if (!Object.keys(payload).length) { setMessage("No hay cambios para guardar."); return; }
      const response = await fetch(`/api/admin/teams/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No pudimos guardar el equipo.");
      originalEditing.current = null;
      setEditing(null); setMessage(`Se guardaron los cambios de ${editing.nombre}.`); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar el equipo."); }
    finally { setSaving(false); }
  }

  async function copyGenerated() {
    await navigator.clipboard.writeText(generated.join("\n"));
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    window.setTimeout(() => setCopiedCode((current) => current === code ? "" : current), 1600);
  }

  async function createBackup() {
    if (!backupConfirming) { setBackupConfirming(true); return; }
    setBackupBusy(true); setSystemError("");
    try {
      const response = await fetch("/api/admin/system", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "No pudimos crear el respaldo.");
      }
      const blob = await response.blob();
      const filename = response.headers.get("Content-Disposition")?.match(/filename="?([^\";]+)"?/i)?.[1] ?? "lid-backup.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupConfirming(false);
      await loadSystem();
    } catch (cause) {
      setSystemError(cause instanceof Error ? cause.message : "No pudimos crear el respaldo.");
    } finally { setBackupBusy(false); }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let size = bytes / 1024; let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
    return `${size.toLocaleString("es-AR", { maximumFractionDigits: 1 })} ${units[unit]}`;
  };

  const sectionContent = loading && section !== "sistema" ? <div className="admin-state"><LoaderCircle className="spin" size={17} /> Cargando información…</div>
    : error && !data.teams.length && !data.codes.length && section !== "sistema" ? <div className="admin-state">{error}<button type="button" onClick={() => void load()}>Reintentar</button></div>
    : section === "equipos" ? <section className="admin-card admin-list-card">
      <div className="admin-section-heading"><div><span className="admin-kicker">REGISTRO</span><h2>Equipos registrados</h2></div><small>{visibleTeams.length} equipos</small></div>
      <div className="admin-team-view-toggle"><button type="button" className={teamView === "active" ? "active" : ""} onClick={() => { setTeamView("active"); setTeamActionConfirm(null); }}>Activos <span>{activeTeams.length}</span></button><button type="button" className={teamView === "archived" ? "active" : ""} onClick={() => { setTeamView("archived"); setTeamActionConfirm(null); }}>Archivados <span>{archivedTeams.length}</span></button></div>
      {visibleTeams.length === 0 ? <div className="admin-empty"><UsersRound size={20} /><p>Todavía no hay equipos registrados.</p></div> : <div className="admin-team-list">{visibleTeams.map((team) => <article className="admin-team-row" key={team.id}>
        <div className="admin-team-main"><span className="admin-team-course">{team.curso} · {team.division}</span><h3>{team.nombre}</h3><time className="admin-team-created" dateTime={team.fecha_registro}>Creado {new Date(team.fecha_registro).toLocaleString("es-AR")}</time><p>{team.sistema}{team.sistema === "4:2" && team.tipo ? ` · ${team.tipo === "c" ? "Centrales" : "Opuestos"}` : ""}<span>·</span>{team.integrantes.length} integrantes<span>·</span><i className="mini-status is-good">{team.integrantes.filter((player) => player.autorizacion).length}/{team.integrantes.length} autorizados</i></p></div>
        <div className="admin-team-actions">{teamActionConfirm === team.id && <span className="team-archive-explain">Se conservan los datos y se libera el cupo.</span>}
          {!team.deleted_at && <button className="admin-icon-button" type="button" onClick={() => { const snapshot = structuredClone(team); originalEditing.current = structuredClone(snapshot); setEditing(snapshot); setPositionFilter(""); setError(""); }} aria-label={`Editar ${team.nombre}`}><Pencil size={15} /></button>}
          {team.deleted_at ? <button className="admin-icon-button" type="button" disabled={teamActionBusy === team.id} onClick={() => void teamAction(team, "restore")} aria-label={`Recuperar ${team.nombre}`} title="Recuperar equipo">{teamActionBusy === team.id ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}</button>
            : teamActionConfirm === team.id ? <><button className="admin-team-confirm" type="button" disabled={teamActionBusy === team.id} onClick={() => void teamAction(team, "archive")}>{teamActionBusy === team.id ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} Confirmar archivo</button><button className="admin-icon-button" type="button" onClick={() => setTeamActionConfirm(null)} aria-label="Cancelar archivo"><X size={14} /></button></>
              : <button className="admin-icon-button archive-button" type="button" onClick={() => void teamAction(team, "archive")} aria-label={`Archivar ${team.nombre}`} title="Archivar y liberar cupo"><Archive size={14} /></button>}
        </div>
      </article>)}</div>}
    </section>
    : section === "codigos" ? <section className="admin-card admin-list-card">
      <div className="admin-section-heading"><div><span className="admin-kicker">ACCESO AL FORMULARIO</span><h2>Códigos de registro</h2></div><small>{data.codes.length} recientes</small></div>
      <div className="code-generator"><div><strong>Generar código</strong><small>Único, aleatorio y de seis caracteres.</small></div><div className="generator-controls"><button className="admin-primary compact" type="button" onClick={() => void generateCodes()} disabled={Boolean(busy)}>{busy === "generate" ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />} Generar</button></div></div>
      {generated.length > 0 && <div className="generated-codes"><div><strong>Código nuevo</strong><button type="button" onClick={() => void copyGenerated()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copiado" : "Copiar"}</button></div><p>{generated.map((code) => <button className="code-copy" key={code} type="button" onClick={() => void copyCode(code)} aria-label={`Copiar código ${code}`}>{code}</button>)}</p></div>}
      {data.codes.length === 0 ? <div className="admin-empty"><KeyRound size={19} /><p>No hay códigos cargados.</p></div> : <div className="admin-code-list">{data.codes.map((code) => <article className="admin-code-row" key={code.codigo}><div className="admin-code-value"><button className="code-copy" type="button" onClick={() => void copyCode(code.codigo)} aria-label={`Copiar código ${code.codigo}`}>{copiedCode === code.codigo ? <Check size={12} /> : <Copy size={12} />}<code>{code.codigo}</code></button><span>{code.usado && !code.cancelado ? (code.equipo ? `Usado por ${code.equipo}${code.curso ? ` · ${code.curso} ${code.division ?? ""}` : ""}` : "Usado · sin equipo asociado") : new Date(code.fecha_creacion).toLocaleDateString("es-AR")}</span></div><span className={`code-status ${code.cancelado ? "is-cancelled" : code.usado ? "is-used" : "is-active"}`}>{code.cancelado ? "Cancelado" : code.usado ? "Utilizado" : "Disponible"}</span>{!code.usado && !code.cancelado && <div className="code-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void codeAction(code.codigo)} title="Cancelar código" aria-label={`Cancelar ${code.codigo}`}>{busy === code.codigo ? <LoaderCircle className="spin" size={14} /> : <X size={14} />}</button></div>}</article>)}</div>}
    </section>
    : section === "normas" ? <NormsManager />
    : section === "cupos" ? <CapacitySettings />
    : <section className="system-dashboard">
      <header className="admin-system-intro"><div><span className="admin-kicker">MANTENIMIENTO</span><h2>Base de datos y actividad</h2><p>Espacio utilizado y acciones administrativas registradas.</p></div><button className="admin-primary compact" type="button" onClick={() => void createBackup()} disabled={backupBusy || systemLoading || !systemOverview}>{backupBusy ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} {backupConfirming ? "Confirmar y descargar" : "Preparar respaldo"}</button></header>
      {backupConfirming && <div className="system-backup-confirm" role="alert"><p>El respaldo incluye nombres, teléfonos, códigos de registro y auditoría. Se descargará en este dispositivo; guardalo en un lugar privado.</p><button className="admin-logout" type="button" onClick={() => setBackupConfirming(false)} disabled={backupBusy}>Cancelar</button></div>}
      {systemError && <div className="admin-alert is-error" role="alert">{systemError}</div>}
      {systemLoading && !systemOverview ? <div className="admin-state"><LoaderCircle className="spin" size={17} /> Consultando la base…</div> : systemOverview && <>
        <div className="system-metrics"><article className="admin-metric"><span>Espacio de la base</span><strong>{formatBytes(systemOverview.database_size_bytes)}</strong><Database size={16} /></article><article className="admin-metric"><span>Eventos de auditoría</span><strong>{(systemOverview.counts.vit_admin_audit_logs ?? systemOverview.audit.length).toLocaleString("es-AR")}</strong><FileText size={16} /></article></div>
        <section className="admin-card system-audit"><div className="admin-section-heading"><div><span className="admin-kicker">TRAZABILIDAD</span><h2>Auditoría reciente</h2></div><small>Últimos {systemOverview.audit.length} eventos</small></div>
          {systemOverview.audit.length ? <div className="system-audit-list">{systemOverview.audit.map((entry, index) => <details className="system-audit-entry" key={`${entry.created_at}-${entry.entity_type}-${entry.entity_id}-${index}`}>
            <summary><span><strong>{auditLabels[entry.action] ?? entry.action}</strong><small>{auditSummary(entry)}</small></span><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("es-AR")}</time></summary>
            <div className="system-audit-detail"><span>Responsable: {entry.actor_email}</span><span>Registro: {entry.entity_type} · {entry.entity_id}</span>{Object.keys(entry.details ?? {}).length > 0 && <dl>{Object.entries(entry.details).map(([key, value]) => <div key={key}><dt>{auditDetailLabels[key] ?? key}</dt><dd>{auditDetailValue(key, value)}</dd></div>)}</dl>}</div>
          </details>)}</div> : <div className="admin-empty"><FileText size={18} /><p>No hay acciones registradas.</p></div>}
        </section><p className="system-backup-note">El respaldo descarga un archivo JSON con los datos del torneo y la auditoría. No incluye cuentas de acceso, sesiones ni el esquema SQL. Guardalo en un lugar seguro: contiene nombres y teléfonos de contacto.</p>
      </>}{!systemLoading && !systemOverview && !systemError && <div className="admin-state">No hay datos del sistema disponibles.</div>}
    </section>;

  async function logout() { await client.signOut(); window.location.assign("/atun"); }

  return <main className="admin-shell admin-dashboard-shell">
    <div className="admin-topbar"><Link className="back-link" href="/"><ArrowLeft size={14} /><span>Inicio</span></Link><button className="admin-logout" type="button" onClick={logout}><span>{email}</span><LogOut size={14} /> Salir</button></div>
    <header className="admin-heading"><p className="eyebrow">LID {new Date().getFullYear()} · ORGANIZACIÓN</p><h1>Panel <span>admin</span></h1><p>Equipos, participantes y accesos de registro.</p></header>
    <section className="admin-metrics" aria-label="Resumen"><article className="admin-metric"><span>Equipos</span><strong>{loading ? "—" : activeTeams.length}</strong><UsersRound size={16} /></article><article className="admin-metric"><span>Participantes</span><strong>{loading ? "—" : participants}</strong><UsersRound size={16} /></article><article className="admin-metric"><span>Códigos activos</span><strong>{loading ? "—" : data.codes.filter((code) => !code.usado && !code.cancelado).length}</strong><KeyRound size={16} /></article></section>
    <nav className="admin-tabs" aria-label="Secciones del panel"><button type="button" className={section === "equipos" ? "active" : ""} onClick={() => setSection("equipos")}><UsersRound size={15} /> Equipos <span>{activeTeams.length}</span></button><button type="button" className={section === "codigos" ? "active" : ""} onClick={() => setSection("codigos")}><KeyRound size={15} /> Códigos <span>{data.codes.length}</span></button><button type="button" className={section === "normas" ? "active" : ""} onClick={() => setSection("normas")}><FileText size={15} /> Normas</button><button type="button" className={section === "cupos" ? "active" : ""} onClick={() => setSection("cupos")}><SlidersHorizontal size={15} /> Cupos</button><button type="button" className={section === "sistema" ? "active" : ""} onClick={() => setSection("sistema")}><Database size={15} /> Sistema</button><button className="admin-refresh" type="button" onClick={() => section === "sistema" ? void loadSystem() : section === "cupos" ? window.dispatchEvent(new Event("lid:capacity-refresh")) : void load()} disabled={loading || systemLoading} aria-label="Actualizar datos"><RefreshCw className={loading || systemLoading ? "spin" : ""} size={14} /></button></nav>
    {sectionContent}
    {(message || error) && <div className={`admin-alert ${error ? "is-error" : ""}`} role="status">{error || message}<button type="button" onClick={() => { setMessage(""); setError(""); }} aria-label="Cerrar"><X size={14} /></button></div>}
    <footer className="admin-footer">E.E.S.T N°2 <span>·</span> LID {new Date().getFullYear()}</footer>
    {editing && <div className="admin-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { originalEditing.current = null; setEditing(null); } }}><form className="admin-editor" noValidate onSubmit={saveTeam} aria-label={`Editar equipo ${editing.nombre}`}><div className="editor-header"><div><span className="admin-kicker">EDICIÓN MANUAL</span><h2>Editar equipo</h2></div><button type="button" className="admin-icon-button" onClick={() => { originalEditing.current = null; setEditing(null); }} aria-label="Cerrar"><X size={16} /></button></div><div className="editor-scroll"><div className="editor-grid"><label className="admin-field"><span>Nombre del equipo</span><input value={editing.nombre} maxLength={60} onChange={(event) => setEditing({ ...editing, nombre: event.target.value })} required /></label><div className="editor-course"><label className="admin-field"><span>Curso</span><select value={editing.curso} onChange={(event) => { const curso = event.target.value; setEditing({ ...editing, curso, division: ["1ro", "2do", "3ro"].includes(curso) ? "A" : "1ra" }); }}>{courses.map((course) => <option key={course}>{course}</option>)}</select></label><label className="admin-field"><span>División</span><select value={editing.division} onChange={(event) => setEditing({ ...editing, division: event.target.value })}>{(["1ro", "2do", "3ro"].includes(editing.curso) ? ["A", "B", "C"] : ["1ra", "2da"]).map((division) => <option key={division}>{division}</option>)}</select></label></div><div className="editor-course"><label className="admin-field"><span>Sistema</span><select value={editing.sistema} onChange={(event) => { const sistema = event.target.value; setEditing({ ...editing, sistema, tipo: sistema === "4:2" ? editing.tipo ?? "c" : null, integrantes: sistema === "6:0" ? editing.integrantes.map((player) => ({ ...player, posicion: null })) : editing.integrantes }); }}>{["6:0", "4:2", "5:1"].map((system) => <option key={system}>{system}</option>)}</select></label>{editing.sistema === "4:2" && <label className="admin-field"><span>Tipo 4:2</span><select value={editing.tipo ?? "c"} onChange={(event) => setEditing({ ...editing, tipo: event.target.value })}><option value="c">Centrales</option><option value="o">Opuestos</option></select></label>}</div><label className="admin-field"><span>Color de camiseta</span><input value={editing.color} maxLength={32} onChange={(event) => setEditing({ ...editing, color: event.target.value })} required /></label><label className="admin-field"><span>Teléfono del capitán</span><input inputMode="numeric" value={editing.telefono} maxLength={15} onChange={(event) => setEditing({ ...editing, telefono: event.target.value.replace(/\D/g, "") })} required /></label><div className="editor-roster-head"><div><span className="admin-kicker">INTEGRANTES</span><small>El primero es el capitán · {editing.integrantes.length}/9</small></div><button type="button" className="editor-add" disabled={editing.integrantes.length >= 9} onClick={() => setEditing({ ...editing, integrantes: [...editing.integrantes, { uiKey: crypto.randomUUID(), nombre: "", posicion: null, suplente: editing.integrantes.length >= rosterMinimum(editing.sistema, editing.tipo), autorizacion: false }] })}><Plus size={13} /> Agregar</button></div>{editing.sistema !== "6:0" && (<div className="editor-filter"><label className="sr-only" htmlFor="position-filter">Filtrar por posición</label><select id="position-filter" value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)}><option value="">Todas las posiciones</option>{[...new Set(positionSlots(editing.sistema, editing.tipo))].map((position) => <option key={position}>{position}</option>)}</select><span>{editing.integrantes.filter((player) => !positionFilter || player.posicion === positionFilter).length} visibles{positionFilter ? " · quitá el filtro para reordenar" : ""}</span></div>)}{editing.integrantes.map((player, index) => (!positionFilter || player.posicion === positionFilter) && <div className={`editor-player ${editing.sistema === "6:0" ? "no-position" : ""}`} key={player.id ?? player.uiKey ?? `player-${index}`}><span className="editor-player-number">{String(index + 1).padStart(2, "0")}</span><div className="editor-player-name"><input aria-label={`Nombre de integrante ${index + 1}`} value={player.nombre} maxLength={64} onChange={(event) => setEditing({ ...editing, integrantes: editing.integrantes.map((current, currentIndex) => currentIndex === index ? { ...current, nombre: event.target.value } : current) })} required /><button type="button" className="editor-move" disabled={index === 0 || Boolean(positionFilter)} onClick={() => { const list = [...editing.integrantes]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; setEditing({ ...editing, integrantes: list }); }} aria-label={`Mover integrante ${index + 1} arriba`}><ArrowUp size={12} /></button><button type="button" className="editor-move" disabled={index === editing.integrantes.length - 1 || Boolean(positionFilter)} onClick={() => { const list = [...editing.integrantes]; [list[index + 1], list[index]] = [list[index], list[index + 1]]; setEditing({ ...editing, integrantes: list }); }} aria-label={`Mover integrante ${index + 1} abajo`}><ArrowDown size={12} /></button></div>{editing.sistema !== "6:0" && <select aria-label={`Posición de integrante ${index + 1}`} value={player.posicion ?? ""} disabled={editing.sistema === "6:0"} className={!player.posicion ? "position-empty" : ""} onChange={(event) => setEditing({ ...editing, integrantes: editing.integrantes.map((current, currentIndex) => currentIndex === index ? { ...current, posicion: event.target.value || null } : current) })}><option value="">— Posición</option>{availablePositions(editing.integrantes, index, editing.sistema, editing.tipo).map((position) => <option key={position}>{position}</option>)}</select>}<select aria-label={`Condición de integrante ${index + 1}`} value={player.suplente ? "suplente" : "titular"} onChange={(event) => setEditing({ ...editing, integrantes: editing.integrantes.map((current, currentIndex) => currentIndex === index ? { ...current, suplente: event.target.value === "suplente" } : current) })}><option value="titular">Titular</option><option value="suplente">Suplente</option></select><label className="editor-player-consent" title="Autorización de este integrante"><input type="checkbox" checked={player.autorizacion} onChange={(event) => setEditing({ ...editing, integrantes: editing.integrantes.map((current,currentIndex) => currentIndex===index ? {...current,autorizacion:event.target.checked}:current) })} /><span>{player.autorizacion ? <ShieldCheck size={13} /> : <ShieldX size={13} />}</span></label><button type="button" className="remove-player" disabled={editing.integrantes.length <= rosterMinimum(editing.sistema, editing.tipo)} onClick={() => setEditing({ ...editing, integrantes: normalizeRoster(editing.integrantes.filter((_, currentIndex) => currentIndex !== index), rosterMinimum(editing.sistema, editing.tipo)) })} aria-label={`Quitar integrante ${index + 1}`}><X size={14} /></button></div>)}{editing.integrantes.length === 9 && <label className="admin-field"><span>Justificación del noveno integrante</span><textarea rows={2} maxLength={300} value={editing.justificacion_admin} onChange={(event) => setEditing({ ...editing, justificacion_admin: event.target.value })} required /></label>}</div></div><div className="editor-footer"><span><FileText size={13} /> Los cambios quedan registrados en auditoría.</span><button className="admin-primary compact" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} Guardar cambios</button></div></form></div>}
  </main>;
}
