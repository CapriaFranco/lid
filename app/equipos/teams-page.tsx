"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, RefreshCw, UsersRound } from "lucide-react";

type Player = { nombre: string; posicion: string | null; suplente: boolean; autorizacion: boolean };
type Team = { id: number; nombre: string; curso: string; division: string; sistema: string; color: string; integrantes: Player[] };
type Cycle = "ambos" | "basico" | "superior";
const options: { value: Cycle; number: string; label: string }[] = [
  { value: "ambos", number: "01", label: "Ambos ciclos" },
  { value: "basico", number: "02", label: "Ciclo Básico" },
  { value: "superior", number: "03", label: "Ciclo Superior" },
];
const basicCourses = ["1ro", "2do", "3ro"];

export default function TeamsPage() {
  const [cycle, setCycle] = useState<Cycle>("ambos");
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/teams?cycle=ambos", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No pudimos cargar los equipos.");
        if (active) setAllTeams(data.teams);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "No pudimos cargar los equipos.");
        setAllTeams([]);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [retry]);

  useEffect(() => {
    let wasHidden = false;
    const refreshOnReturn = () => {
      if (document.visibilityState === "hidden") { wasHidden = true; return; }
      if (wasHidden) { wasHidden = false; setRetry((attempt) => attempt + 1); }
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);

  const teams = cycle === "ambos" ? allTeams : allTeams.filter((team) => cycle === "basico" ? basicCourses.includes(team.curso) : !basicCourses.includes(team.curso));
  const participants = teams.reduce((count, team) => count + team.integrantes.length, 0);
  const cycleTitle = cycle === "basico" ? "Ciclo Básico" : cycle === "superior" ? "Ciclo Superior" : "Ambos ciclos";

  return <main className="teams-shell">
    <Link className="back-link" href="/"><ArrowLeft size={15} strokeWidth={1.8} /><span>Volver al inicio</span></Link>
    <header className="teams-heading"><p className="eyebrow">EQUIPOS DE</p><h1>{cycle === "ambos" ? "Ambos" : "Ciclo"} <span>{cycle === "basico" ? "Básico" : cycle === "superior" ? "Superior" : "ciclos"}</span></h1><p>Equipos registrados en LID {new Date().getFullYear()}.</p></header>

    <div className="cycle-switch" role="tablist" aria-label="Ciclo escolar">{options.map((option) => <button key={option.value} type="button" role="tab" aria-selected={cycle === option.value} className={`cycle-tab ${cycle === option.value ? "active" : ""} ${option.value === "ambos" ? "cycle-tab-both" : ""}`} onClick={() => setCycle(option.value)}><span className="cycle-index">{option.number}</span><span>{option.label}</span></button>)}</div>

    <section className="teams-content" aria-label={`Equipos: ${cycleTitle}`}>
      <div className="teams-content-head"><span className="teams-cycle-label">{cycleTitle}</span><div className="teams-summary"><span><strong>{loading || error ? "-" : teams.length}</strong> equipos</span><i /><span><strong>{loading || error ? "-" : participants}</strong> participantes</span></div></div>
      {loading ? <div className="teams-state"><LoaderCircle className="spin" size={17} /><span>Cargando equipos…</span></div> : error ? <div className="teams-state teams-error"><p>{error}</p><button className="retry-button" type="button" onClick={() => setRetry((attempt) => attempt + 1)}><RefreshCw size={13} /> Reintentar</button></div> : teams.length === 0 ? <div className="teams-state teams-empty"><UsersRound size={20} strokeWidth={1.5} /><p>Todavía no hay equipos disponibles en este ciclo.</p></div> : <div className="team-cards">{teams.map((team) => <article className="public-team-card" key={team.id}><header className="public-team-head"><h2 className="public-team-name"><TapValue className="team-name-value" text={team.nombre} /></h2><TapValue className="public-team-course" text={`${team.curso} · ${team.division}`} /></header><dl className="public-team-details"><div><dt>Sistema</dt><dd><TapValue text={team.sistema} /></dd></div><div><dt>Color</dt><dd><TapValue text={team.color} /></dd></div><div><dt>Integrantes</dt><dd>{team.integrantes.length}</dd></div></dl><section className="public-team-roster"><h3>Integrantes</h3><ul>{team.integrantes.map((player, index) => <li key={`${team.id}-${index}`}><TapValue className="roster-name" text={player.nombre} /><TapValue className="roster-position" text={player.posicion || "-"} /><span className={`authorization-badge ${player.autorizacion ? "authorized" : "missing"}`}><i />{player.autorizacion ? "Con autorización" : "Sin autorización"}</span></li>)}</ul></section></article>)}</div>}
    </section>
    <footer className="registration-footer">E.E.S.T N°2 <span>·</span> LID {new Date().getFullYear()}</footer>
  </main>;
}

function TapValue({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const timeout = window.setTimeout(() => setOpen(false), 6000);
    document.addEventListener("pointerdown", closeOutside);
    return () => { window.clearTimeout(timeout); document.removeEventListener("pointerdown", closeOutside); };
  }, [open]);
  return <span ref={root} className={`tap-value ${className}`} data-full={text} tabIndex={0} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen((current) => !current); } if (event.key === "Escape") setOpen(false); }} aria-label={text}>{text}{open && <span className="tap-tooltip" role="tooltip">{text}</span>}</span>;
}
