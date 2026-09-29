import { ArrowUpRight, BookOpenText, ClipboardPenLine, MessageCircleMore, UsersRound } from "lucide-react";

const year = new Date().getFullYear();
const links = [
  { title: "Normas", detail: "Reglamento del torneo", href: "/normas", icon: BookOpenText },
  { title: "Registro", detail: "Inscribí a tu equipo", href: "/registro", icon: ClipboardPenLine },
  { title: "Equipos", detail: "Registrados de momento", href: "/equipos", icon: UsersRound },
  { title: "WhatsApp", detail: "Ingresá al grupo para recibir información", href: "https://chat.whatsapp.com/CbpE4tkN2kMAoaTlkQXSLr", icon: MessageCircleMore, external: true },
];

export default function Home() {
  return <main className="shell">
    <section className="welcome" id="inicio"><p className="eyebrow">TORNEO INTERNO DE VÓLEY</p><h1>LID <span>{year}</span></h1></section>
    <nav className="glass-menu" aria-label="Accesos principales">{links.map((link) => { const Icon = link.icon; return <a className="menu-link" href={link.href} key={link.title} {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}><span className="menu-icon"><Icon size={17} strokeWidth={1.65} /></span><span className="menu-label"><strong>{link.title}</strong><small>{link.detail}</small></span><span className="menu-arrow" aria-hidden="true"><ArrowUpRight size={15} strokeWidth={1.6} /></span></a>; })}</nav>
    <footer>E.E.S.T N°2 <span>·</span> LID {year}</footer>
  </main>;
}
