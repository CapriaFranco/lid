"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setMessage("No pudimos validar el acceso. Revisá tus datos.");
      setBusy(false);
      return;
    }
    window.location.assign("/atun/panel");
  }

  return <main className="admin-shell admin-login-shell">
    <Link className="back-link" href="/"><ArrowLeft size={15} /><span>Volver al inicio</span></Link>
    <header className="admin-heading"><p className="eyebrow">LID {new Date().getFullYear()} · PRIVADO</p><h1>Panel <span>admin</span></h1><p>Ingresá con la cuenta de organización.</p></header>
    <form className="admin-card admin-login-card" onSubmit={submit}>
      <div className="admin-card-title"><span className="admin-icon"><LockKeyhole size={16} /></span><div><strong>Acceso seguro</strong><small>Solo para administración</small></div></div>
      <label className="admin-field"><span>Email</span><input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="admin-field"><span>Contraseña</span><input type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {message && <p className="admin-message admin-message-error" role="alert">{message}</p>}
      <p className="admin-footnote">Cuenta de administrador configurada por la organización.</p>
      <button className="admin-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={15} /> Validando…</> : <>Ingresar al panel <ArrowUpRight size={15} /></>}</button>
    </form>
    <footer className="admin-footer">E.E.S.T N°2 <span>·</span> LID {new Date().getFullYear()}</footer>
  </main>;
}
