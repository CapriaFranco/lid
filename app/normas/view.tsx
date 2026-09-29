"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import type { JSONContent } from "@tiptap/core";
import { ArrowLeft, BookOpenText, LoaderCircle } from "lucide-react";

type Norm = { id: number; slug: string; titulo: string; resumen: string; documento: JSONContent };
type Category = { id: number; normas: Norm[] };
type Mark = { type: string; attrs?: { color?: string } };
const textPalette = ["#2B2827", "#F03732", "#B01610", "#E56A12", "#E5BE12", "#5ABF4C", "#57BA86", "#4CBFB9", "#4C69BF", "#171AE6", "#E01B84", "#0000FF"];
const barPalette = ["#E01B84", "#0000FF"];

function renderText(text: string, marks: Mark[] = []): ReactNode {
  return marks.reduce<ReactNode>((content, mark, index) => {
    if (mark.type === "bold") return <strong key={index}>{content}</strong>;
    if (mark.type === "italic") return <em key={index}>{content}</em>;
    if (mark.type === "underline") return <u key={index}>{content}</u>;
    if (mark.type === "superscript") return <sup key={index} className="norm-script">{content}</sup>;
    if (mark.type === "subscript") return <sub key={index} className="norm-script">{content}</sub>;
    if (mark.type === "reference") return <span key={index} className="norm-inline-reference">{content}</span>;
    if (mark.type === "textColor" && textPalette.includes(mark.attrs?.color ?? "")) return <span key={index} style={{ color: mark.attrs?.color }}>{content}</span>;
    return content;
  }, text);
}

function textContent(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return node.content?.map(textContent).join("") ?? "";
}

function headingId(text: string, index: number): string {
  const slug = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `norma-${index}-${slug || "seccion"}`;
}

function renderDocument(node: JSONContent, key: string, idByKey: string): ReactNode {
  if (node.type === "text") return renderText(node.text ?? "", node.marks as Mark[] | undefined);
  if (node.type === "hardBreak") return <br key={key} />;
  const attrs = node.attrs ?? {};
  const indent = Math.min(4, Math.max(0, Number(attrs.indent) || 0));
  const color = barPalette.includes(String(attrs.barColor).toUpperCase()) ? String(attrs.barColor).toUpperCase() : "#E01B84";
  const alignment = ["left", "center", "right", "justify"].includes(String(attrs.textAlign)) ? String(attrs.textAlign) as CSSProperties["textAlign"] : "left";
  const style = { "--norm-bar": color, textAlign: alignment } as CSSProperties;
  const children = node.content?.map((child, index) => renderDocument(child, `${key}-${index}`, idByKey));
  if (node.type === "heading") return <h2 key={key} id={idByKey} className={`norm-document-block norm-document-heading norm-indent-${indent} ${attrs.showBar ? "has-bar" : ""}`} style={style}>{children}</h2>;
  if (node.type === "paragraph") return <p key={key} className={`norm-document-block norm-indent-${indent} ${attrs.showBar ? "has-bar" : ""}`} style={style}>{children}</p>;
  return null;
}

export default function NormsPage() {
  const [norm, setNorm] = useState<Norm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/normas", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("No pudimos cargar las normas.");
      const result = await response.json() as { categories: Category[] };
      setNorm(result.categories.flatMap((category) => category.normas)[0] ?? null);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  }, []);

  const blocks = norm?.documento?.content ?? [];
  const hasContent = blocks.some((block) => textContent(block).trim().length > 0);
  const headings = blocks.flatMap((block, index) => block.type === "heading" && textContent(block).trim()
    ? [{ id: headingId(textContent(block), index), title: textContent(block).trim() }]
    : []);

  return <main className="teams-shell norms-shell">
    <Link className="back-link" href="/"><ArrowLeft size={15} /><span>Volver al inicio</span></Link>
    <header className="teams-heading"><p className="eyebrow">LID {new Date().getFullYear()} · INFORMACIÓN</p><h1>Normas <span>del torneo</span></h1><p>Reglamento y pautas para participar.</p></header>
    {loading ? <div className="teams-state"><LoaderCircle className="spin" size={17} /> Cargando normas…</div> : error ? <div className="teams-state teams-error">No pudimos cargar las normas.</div> : !norm ? <div className="norms-empty"><BookOpenText size={20} /><strong>El reglamento está inactivo o todavía no se cargó.</strong></div> : <section className="norm-category norm-single-sheet">
      {hasContent ? <>
        {headings.length > 0 && <nav className="norm-index" aria-label="Índice del reglamento"><h2>ÍNDICE</h2><ol>{headings.map((heading) => <li key={heading.id}><a href={`#${heading.id}`}><span>{heading.title}</span><i aria-hidden="true" /></a></li>)}</ol></nav>}
        <article className="norm-document-body" aria-label="Normas del torneo">{blocks.map((node, index) => renderDocument(node, `${norm.id}-${index}`, headingId(textContent(node), index)))}</article>
      </> : <div className="norms-empty"><BookOpenText size={20} /><strong>El reglamento está inactivo o todavía no se cargó.</strong></div>}
    </section>}
    <footer className="registration-footer">E.E.S.T N°2 <span>·</span> LID {new Date().getFullYear()}</footer>
  </main>;
}
