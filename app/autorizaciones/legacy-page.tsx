import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";

export const metadata = { title: "Autorizaciones | LID" };

const forms = [
  { cycle: "Ciclo Básico", courses: "1ro, 2do y 3ro", href: "/autorizaciones/autorizacion-basico-lid-2026.pdf", fileName: "autorizacion-basico-lid-2026.pdf" },
  { cycle: "Ciclo Superior", courses: "4to, 5to, 6to y 7mo", href: "/autorizaciones/autorizacion-superior-lid-2026.pdf", fileName: "autorizacion-superior-lid-2026.pdf" },
];

export default function AuthorizationsPage() {
  return <main className="teams-shell">
    <Link className="back-link" href="/"><ArrowLeft size={15} strokeWidth={1.8} /><span>Volver al inicio</span></Link>
    <header className="teams-heading">
      <p className="eyebrow">LID {new Date().getFullYear()} · DOCUMENTACIÓN</p>
      <h1>Autorizaciones</h1>
      <p>Descargá el formulario correspondiente al ciclo de tu equipo.</p>
    </header>
    <section className="authorization-downloads" aria-label="Formularios de autorización">
      {forms.map((form) => <article className="authorization-download-card" key={form.cycle}>
        <span className="authorization-download-icon"><FileText size={18} strokeWidth={1.6} /></span>
        <div className="authorization-download-info"><h2>{form.cycle}</h2><p>{form.courses}</p></div>
        <a className="authorization-download-button" href={form.href} download={form.fileName}>
          <Download size={15} strokeWidth={1.8} /><span>Descargar PDF</span>
        </a>
      </article>)}
    </section>
    <footer className="registration-footer">E.E.S.T N°2 <span>·</span> LID {new Date().getFullYear()}</footer>
  </main>;
}
