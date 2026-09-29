"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, CircleAlert, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { FormSelect } from "@/app/components/form-select";

type Course = "1ro" | "2do" | "3ro" | "4to" | "5to" | "6to" | "7mo";
type Player = { id: string; name: string; position: string };
type Capacity = { curso: string; division: string; cantidad: number };
type ExistingColor = { color: string; ciclo: "basico" | "superior" };
const courses: Course[] = ["1ro", "2do", "3ro", "4to", "5to", "6to", "7mo"];
const isBasic = (course: string) => ["1ro", "2do", "3ro"].includes(course);
const divisionsFor = (course: Course) => isBasic(course) ? ["A", "B", "C"] : ["1ra", "2da"];
const minFor = (system: string, type: string) => system === "5:1" || (system === "4:2" && type === "c") ? 7 : 6;
const personPattern = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/u;
const teamPattern = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]+$/u;
let playerIdSequence = 0;
const createClientId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(playerIdSequence++).toString(36)}`;
const createPlayer = (): Player => ({ id: createClientId("player"), name: "", position: "" });
const positionsFor = (system: string, type: string) => system === "4:2"
  ? type === "o" ? ["Armador", "Armador", "Opuesto", "Opuesto", "Punta", "Punta"] : ["Armador", "Armador", "Central", "Central", "Punta", "Punta", "Libero"]
  : system === "5:1" ? ["Armador", "Opuesto", "Libero", "Central", "Central", "Punta", "Punta"] : [];

export default function RegistrationForm() {
  const [course, setCourse] = useState<Course | "">("");
  const [division, setDivision] = useState("");
  const [capacities, setCapacities] = useState<Capacity[]>([]);
  const [usedColors, setUsedColors] = useState<ExistingColor[]>([]);
  const [capacityLoaded, setCapacityLoaded] = useState(false);
  const [capacityAvailable, setCapacityAvailable] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [nameStatus, setNameStatus] = useState("");
  const [nameMatches, setNameMatches] = useState<string[]>([]);
  const [system, setSystem] = useState("");
  const [systemType, setSystemType] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [phone, setPhone] = useState("");
  const [color, setColor] = useState("");
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const requestId = useRef<string | null>(null);
  const redirectTimer = useRef<number | null>(null);

  useEffect(() => () => { if (redirectTimer.current !== null) window.clearTimeout(redirectTimer.current); }, []);

  useEffect(() => {
    fetch("/api/registration/capacity")
      .then(async (response) => { if (!response.ok) throw new Error("cupos no disponibles"); const result = await response.json(); setCapacities(result.capacities); setUsedColors(result.colors); setCapacityAvailable(true); })
      .catch(() => { setCapacities([]); setCapacityAvailable(false); })
      .finally(() => setCapacityLoaded(true));
  }, []);

  const divisions = useMemo(() => {
    if (!course) return [];
    const candidates = divisionsFor(course);
    if (!capacityAvailable) return candidates;
    return candidates.filter((value) => (capacities.find((item) => item.curso === course && item.division === value)?.cantidad ?? 0) < 2);
  }, [course, capacities, capacityAvailable]);
  const minimum = minFor(system, systemType);
  const requiredPositions = useMemo(() => positionsFor(system, systemType), [system, systemType]);
  const nameValid = teamName.trim().length >= 3 && teamPattern.test(teamName.trim()) && ["available", "similar", "unverified"].includes(nameStatus);
  const typeValid = Boolean(system) && (system !== "4:2" || Boolean(systemType));
  const requiredPlayers = players.slice(0, minimum);
  const optionalPlayersValid = players.slice(minimum).every((player) => !player.name.trim() || (player.name.trim().length >= 3 && personPattern.test(player.name.trim())));
  const playersValid = requiredPlayers.length === minimum && requiredPlayers.every((player) => player.name.trim().length >= 3 && personPattern.test(player.name.trim())) && optionalPlayersValid && (system === "6:0" || requiredPlayers.every((player) => player.position));
  const cycleColors = usedColors.filter((item) => item.ciclo === (isBasic(course) ? "basico" : "superior"));
  const phoneValid = /^\d{8,15}$/.test(phone);
  const colorValid = color.trim().length >= 2 && personPattern.test(color.trim());
  const codeValid = /^[A-Za-z0-9]{6}$/.test(code);
  const systemTypeStep = systemType === "c" ? "04 A" : systemType === "o" ? "04 B" : "04 B";
  const memberStep = 5;
  const phoneStep = memberStep + 1;
  const colorStep = phoneStep + 1;
  const codeStep = colorStep + 1;
  const canSubmit = Boolean(course && division && nameValid && typeValid && playersValid && phoneValid && colorValid && codeValid && consent && capacityAvailable && !success);

  useEffect(() => {
    const name = teamName.trim();
    setNameMatches([]);
    if (name.length < 3 || !teamPattern.test(name)) { setNameStatus(""); return; }
    setNameStatus("checking");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/registration/check-name", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }), signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "No se pudo validar el nombre.");
          setNameMatches(data.similar ?? []);
          if (data.exists) setNameStatus("duplicate");
          else setNameStatus(data.similar?.length ? "similar" : "available");
        })
        .catch((error: unknown) => { if (error instanceof Error && error.name === "AbortError") return; setNameStatus("unverified"); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [teamName]);

  function updatePlayer(index: number, key: keyof Player, value: string) {
    setPlayers((current) => current.map((player, item) => item === index ? { ...player, [key]: value } : player));
  }
  function changeCourse(value: string) { setCourse(value as Course); setDivision(""); setColor(""); }
  function resizePlayers(count: number, clearPositions = false) {
    setPlayers((current) => Array.from({ length: Math.max(count, Math.min(current.length, 8)) }, (_, index) => {
      const player = current[index] ?? createPlayer();
      return { ...player, position: clearPositions ? "" : player.position };
    }));
  }
  function changeSystem(value: string) {
    setSystem(value);
    setSystemType("");
    resizePlayers(value === "4:2" ? 6 : minFor(value, ""), true);
  }
  function changeSystemType(value: string) {
    setSystemType(value);
    resizePlayers(minFor("4:2", value), true);
  }
  function addSubstitute() { if (players.length < 8) setPlayers((current) => [...current, createPlayer()]); }
  function removeSubstitute(index: number) { if (index >= minimum) setPlayers((current) => current.filter((_, playerIndex) => playerIndex !== index)); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !canSubmit) return;
    setBusy(true); setMessage("Enviando el registro…"); setSuccess(false);
    requestId.current ??= createClientId("registration");
    try {
      const response = await fetch("/api/registration", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId.current },
        body: JSON.stringify({ requestId: requestId.current, course, division, teamName, system, systemType: systemType || undefined, players: players.filter((player) => player.name.trim()).map(({ name, position }) => ({ name, ...(position ? { position } : {}) })), color, phone, code, consent }),
      });
      const result = await response.json(); setSuccess(response.ok); setMessage(response.ok ? "Equipo registrado. Recibimos los datos." : result.error ?? "No se pudo completar el registro.");
      if (response.ok) { requestId.current = null; redirectTimer.current = window.setTimeout(() => window.location.assign("/equipos"), 1800); }
    } catch { setMessage("No pudimos conectar. Reintentá; el mismo envío no se duplicará."); }
    finally { setBusy(false); }
  }

  return <main className="registration-shell">
    <Link className="back-link" href="/"><ArrowLeft size={15} strokeWidth={1.8} /><span>Volver al inicio</span></Link>
    <header className="form-heading"><p className="eyebrow">LID {new Date().getFullYear()} · INSCRIPCIONES</p><h1>Registro de equipo</h1></header>

    <form className="registration-card" onSubmit={submit}>
      <div className="code-notice"><div className="notice-icon"><ShieldCheck size={16} strokeWidth={1.6} /></div><div className="notice-copy"><strong>El registro requiere un código especial</strong><span>Pedíselo a la organización para continuar.</span></div><a className="notice-link" href="https://wa.me/541131264254?text=Hola%2C%20necesito%20un%20c%C3%B3digo%20para%20registrar%20mi%20equipo%20en%20LID." target="_blank" rel="noopener noreferrer" aria-label="Solicitar código por WhatsApp"><ArrowUpRight size={15} strokeWidth={1.8} /></a></div>

      <section className="form-step step-visible"><StepTitle number="01" title="Curso" required /><FormSelect value={course} onValueChange={changeCourse} placeholder="Seleccioná tu curso" ariaLabel="Curso" options={courses.map((value) => ({ value, label: value }))} />{!capacityLoaded && <Hint>Consultando disponibilidad…</Hint>}{capacityLoaded && !capacityAvailable && <Hint warning>No se pueden confirmar los cupos en este momento. Podés completar el formulario; el envío se habilitará al conectar el servicio.</Hint>}</section>

      {course && capacityLoaded && <section className="form-step step-visible"><StepTitle number="02" title="División" required /><FormSelect value={division} onValueChange={setDivision} placeholder={divisions.length ? "Seleccioná la división" : "Sin cupos disponibles"} ariaLabel="División" options={divisions.map((value) => ({ value, label: value }))} disabled={!divisions.length} />{divisions.length === 1 && <Hint>La otra división ya completó los dos cupos; queda seleccionada la disponible.</Hint>}{!divisions.length && <Hint warning>Este curso ya completó los cupos.</Hint>}</section>}

      {division && <section className="form-step step-visible"><StepTitle number="03" title="Nombre del equipo" required /><FieldLabel><input className="text-control" value={teamName} onChange={(event) => setTeamName(event.target.value.slice(0, 60))} pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ]+" autoComplete="organization" placeholder="Ej. Las Panteras 2" minLength={3} maxLength={60} aria-label="Nombre del equipo" />{teamName.length > 0 && !teamPattern.test(teamName.trim()) && <span className="field-feedback feedback-error">Usá solo letras, números y espacios.</span>}{teamName.trim().length >= 3 && <span className={`field-feedback ${nameStatus === "duplicate" ? "feedback-error" : nameStatus === "available" ? "feedback-ok" : ""}`} aria-live="polite">{nameStatus === "checking" ? <><LoaderCircle className="spin" size={13} /> Revisando disponibilidad…</> : nameStatus === "duplicate" ? <><CircleAlert size={13} /> Ese nombre ya está registrado.</> : nameStatus === "available" ? <><Check size={13} /> Nombre disponible</> : nameStatus === "similar" ? <>Hay nombres parecidos: {nameMatches.join(", ")}</> : nameStatus === "unverified" ? "No se pudo consultar ahora; se comprobará al enviar." : null}</span>}</FieldLabel></section>}

      {nameValid && <section className="form-step step-visible"><StepTitle number="04" title="Sistema de juego" required /><FormSelect value={system} onValueChange={changeSystem} placeholder="Seleccioná el sistema" ariaLabel="Sistema de juego" options={[{ value: "6:0", label: "6:0" }, { value: "4:2", label: "4:2" }, { value: "5:1", label: "5:1" }]} />{system && <Hint>{system === "6:0" ? "Seis titulares. Este sistema no lleva posiciones." : `Mínimo ${minimum} titulares. Podés sumar suplentes.`}</Hint>}</section>}

      {system === "4:2" && <section className="form-step step-visible"><StepTitle number={systemTypeStep} title="Tipo de sistema 4:2" required /><FormSelect value={systemType} onValueChange={changeSystemType} placeholder="Seleccioná el tipo" ariaLabel="Tipo de sistema 4:2" options={[{ value: "c", label: "4:2 con centrales" }, { value: "o", label: "4:2 con opuestos" }]} /><Hint>{systemType ? `${minimum} titulares según esta variante.` : "La cantidad de titulares cambia según la variante."}</Hint></section>}

      {typeValid && <section className="form-step step-visible members-step"><StepTitle number={String(memberStep).padStart(2, "0")} title="Integrantes" /><p className="step-description">Nombre y apellido. El primero es capitán/a.</p>
        <div className="players-list">{players.map((player, index) => { const starter = index < minimum; const availablePositions = [...new Set(requiredPositions)].filter((position) => players.filter((other, otherIndex) => otherIndex !== index && other.position === position).length < requiredPositions.filter((item) => item === position).length || position === player.position); return <div className={`player-row ${system === "6:0" ? "player-no-position" : ""} ${!starter ? "player-substitute" : ""}`} key={player.id}><span className="player-index">{String(index + 1).padStart(2, "0")}</span><div className="player-fields"><FieldLabel title={index === 0 ? "Capitán/a" : starter ? `Titular ${index + 1}` : `Suplente ${index - minimum + 1}`} required={starter}><input className="text-control" value={player.name} onChange={(event) => updatePlayer(index, "name", event.target.value.slice(0, 64))} pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+" minLength={3} maxLength={64} placeholder="Nombre y apellido" aria-label={`Nombre integrante ${index + 1}`} />{player.name.trim().length > 0 && (player.name.trim().length < 3 || !personPattern.test(player.name.trim())) && <span className="input-error">Ingresá al menos 3 letras, sin símbolos ni números.</span>}</FieldLabel>{system !== "6:0" && starter && <div className="player-position"><FieldLabel title="Posición" required><FormSelect value={player.position} onValueChange={(value) => updatePlayer(index, "position", value)} placeholder="Posición" ariaLabel={`Posición de integrante ${index + 1}`} options={[...new Set(availablePositions)].map((value) => ({ value, label: value }))} /></FieldLabel></div>}{!starter && <button className="remove-substitute" type="button" onClick={() => removeSubstitute(index)} aria-label={`Quitar suplente ${index - minimum + 1}`}><Trash2 size={14} /></button>}</div></div>; })}</div>
        {players.length < 8 && <button className="add-player" type="button" onClick={addSubstitute}><span>＋</span> Agregar suplente <small>opcional</small></button>}

      </section>}

      {playersValid && <section className="form-step step-visible"><StepTitle number={String(phoneStep).padStart(2, "0")} title="Teléfono de contacto" required /><FieldLabel><input className="text-control" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value.slice(0, 15))} pattern="[0-9]{8,15}" placeholder="Ej. 1131264254" minLength={8} maxLength={15} aria-label="Teléfono de contacto" /></FieldLabel><Hint>Solo números, con código de área.</Hint></section>}

      {playersValid && phoneValid && <section className="form-step step-visible"><StepTitle number={String(colorStep).padStart(2, "0")} title="Color de camiseta" required /><FieldLabel><input className="text-control" value={color} onChange={(event) => setColor(event.target.value.slice(0, 32))} pattern="[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+" placeholder="Escribí el color o diseño" aria-label="Color de camiseta" maxLength={32} />{color.length > 0 && !personPattern.test(color.trim()) && <span className="input-error">Usá solo letras y espacios.</span>}</FieldLabel><div className="used-colors"><strong>Colores ya usados · no repetir</strong>{cycleColors.length ? <ul>{cycleColors.map((item) => <li key={item.color}>{item.color}</li>)}</ul> : <span className="used-colors-empty">Todavía no hay colores registrados en este ciclo.</span>}</div></section>}

      {colorValid && <section className="form-step step-visible"><StepTitle number={String(codeStep).padStart(2, "0")} title="Código de registro" required /><FieldLabel><CodeEntry value={code} onChange={setCode} /></FieldLabel>
        <label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Confirmo que todos los integrantes son alumnos de la E.E.S.T. N°2.<b aria-hidden="true"> *</b></span></label>
      </section>}
      {message && <p className={`form-message ${success ? "message-success" : ""}`} role="status">{message}</p>}
      {colorValid && <button className="glass-button submit-button" type="submit" disabled={busy || !canSubmit}>{busy ? <><LoaderCircle className="spin" size={15} /> Enviando registro…</> : success ? <>Registro recibido <Check size={15} /></> : <>Enviar registro <ArrowRight size={16} /></>}</button>}
    </form>
    <footer className="registration-footer">E.E.S.T N°2 <span>·</span> LID {new Date().getFullYear()}</footer>

  </main>;
}

function StepTitle({ number, title, required = false }: { number: string; title: string; required?: boolean }) { return <div className="step-title"><span>{number}</span><h2>{title}{required && <b className="required-mark" aria-label="obligatorio">*</b>}</h2></div>; }
function FieldLabel({ title, required = false, children }: { title?: string; required?: boolean; children: React.ReactNode }) { return <label className="field-label">{title && <span className="field-label-text">{title}{required && <b className="required-mark" aria-label="obligatorio">*</b>}</span>}{children}</label>; }
function Hint({ children, warning = false }: { children: React.ReactNode; warning?: boolean }) { return <p className={`form-hint ${warning ? "hint-warning" : ""}`}>{warning && <CircleAlert size={13} />}{children}</p>; }




function CodeEntry({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  function update(index: number, rawValue: string) {
    const cleaned = rawValue.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!cleaned) {
      const next = value.split("");
      if (next[index]) next.splice(index, 1);
      onChange(next.join(""));
      inputs.current[Math.max(0, index - 1)]?.focus();
      return;
    }
    const next = value.padEnd(6, " ").split("");
    for (let offset = 0; offset < cleaned.length && index + offset < 6; offset++) next[index + offset] = cleaned[offset];
    const result = next.join("").trimEnd();
    onChange(result);
    const nextIndex = Math.min(index + cleaned.length, 5);
    if (index + cleaned.length < 6) inputs.current[nextIndex]?.focus();
    else inputs.current[5]?.blur();
  }
  function paste(event: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const pasted = event.clipboardData.getData("text").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (!pasted) return;
    event.preventDefault();
    const result = (value.slice(0, index) + pasted + value.slice(index)).slice(0, 6);
    onChange(result);
    inputs.current[Math.min(index + pasted.length, 5)]?.focus();
  }
  return <div className="code-inputs" role="group" aria-label="Código de registro">{Array.from({ length: 6 }, (_, index) => <input key={index} ref={(element) => { inputs.current[index] = element; }} className="code-cell" value={value[index] ?? ""} onFocus={() => { if (index > value.length) inputs.current[value.length]?.focus(); }} onChange={(event) => update(index, event.target.value)} onPaste={(event) => paste(event, index)} onKeyDown={(event) => { if (event.key === "Backspace" && !value[index] && index > 0) { event.preventDefault(); const next = value.split(""); next.splice(index - 1, 1); onChange(next.join("")); inputs.current[index - 1]?.focus(); } if (event.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus(); if (event.key === "ArrowRight" && index < 5) inputs.current[index + 1]?.focus(); }} inputMode="text" autoComplete={index === 0 ? "one-time-code" : "off"} aria-label={`Carácter ${index + 1} del código`} maxLength={6} />)}</div>;
}
