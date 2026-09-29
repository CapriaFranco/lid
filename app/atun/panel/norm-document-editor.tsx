"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Extension, Mark, mergeAttributes, type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Heading2, IndentDecrease, IndentIncrease, Italic, Pilcrow, Redo2, Underline, Undo2, PanelLeft, PanelLeftClose, Superscript as SuperscriptIcon, Subscript as SubscriptIcon, ChevronDown } from "lucide-react";

const palette = [
  { name: "Negro texto", value: "#2B2827" },
  { name: "Crítico", value: "#F03732" },
  { name: "Rojo", value: "#B01610" },
  { name: "Naranja", value: "#E56A12" },
  { name: "Amarillo", value: "#E5BE12" },
  { name: "Verde", value: "#5ABF4C" },
  { name: "Verde acento", value: "#57BA86" },
  { name: "Celeste", value: "#4CBFB9" },
  { name: "Azulado", value: "#4C69BF" },
  { name: "Azul", value: "#171AE6" },
  { name: "Fucsia institucional", value: "#E01B84" },
  { name: "Azul eléctrico", value: "#0000FF" },
] as const;
const defaultTextColor = "#2B2827";
const defaultBarColor = "#E01B84";
const colorValues: string[] = palette.map(({ value }) => value);
const barPalette = palette.filter(({ value }) => value === "#E01B84" || value === "#0000FF");
const barColorValues: string[] = barPalette.map(({ value }) => value);
const ReferenceMark = Mark.create({
  name: "reference",
  parseHTML() { return [{ tag: "span[data-norm-reference]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-norm-reference": "true" }), 0]; },
});
const TextColorMark = Mark.create({
  name: "textColor",
  addAttributes() {
    return { color: { default: defaultTextColor, parseHTML: (element) => element.getAttribute("data-norm-text-color") } };
  },
  parseHTML() { return [{ tag: "span[data-norm-text-color]" }]; },
  renderHTML({ HTMLAttributes }) {
    const color = colorValues.includes(HTMLAttributes.color) ? HTMLAttributes.color : defaultTextColor;
    return ["span", mergeAttributes({ "data-norm-text-color": color, style: `color: ${color}` }), 0];
  },
});

function ColorMenu({ label, value, colors, onSelect, preserveSelection }: { label: string; value: string; colors: readonly { name: string; value: string }[]; onSelect: (color: string) => void; preserveSelection: (event: MouseEvent<HTMLElement>) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = colors.find((color) => color.value === value) ?? colors[0];
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return <div className="norm-color-menu" ref={root}>
    <button type="button" className="norm-color-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onMouseDown={preserveSelection} onClick={() => setOpen((current) => !current)}>
      <span className="norm-color-swatch" style={{ backgroundColor: selected.value }} />
      <span className="norm-color-current"><span>{selected.name}</span><small>{selected.value}</small></span>
      <ChevronDown size={13} />
    </button>
    {open && <div className="norm-color-options" role="listbox" aria-label={label}>{colors.map((color) => <button type="button" role="option" aria-selected={color.value === value} className="norm-color-option" key={color.value} onMouseDown={preserveSelection} onClick={() => { onSelect(color.value); setOpen(false); }}><span className="norm-color-swatch" style={{ backgroundColor: color.value }} /><span>{color.name}</span><small>{color.value}</small></button>)}</div>}
  </div>;
}
const NormBlockStyle = Extension.create({
  name: "normBlockStyle",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => Math.min(4, Math.max(0, Number(element.getAttribute("data-indent")) || 0)),
          renderHTML: (attributes) => ({ "data-indent": String(attributes.indent) }),
        },
        showBar: {
          default: false,
          parseHTML: (element) => element.getAttribute("data-show-bar") === "true",
          renderHTML: (attributes) => attributes.showBar ? { "data-show-bar": "true" } : {},
        },
        barColor: {
          default: "#e01b84",
          parseHTML: (element) => barColorValues.includes(element.getAttribute("data-bar-color") ?? "") ? element.getAttribute("data-bar-color") : defaultBarColor,
          renderHTML: (attributes) => { const color = barColorValues.includes(attributes.barColor) ? attributes.barColor : defaultBarColor; return { "data-bar-color": color, style: `--norm-bar: ${color}` }; },
        },
      },
    }];
  },
});

export const emptyNormDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { indent: 0, showBar: false, barColor: defaultBarColor, textAlign: "left" } }],
};

export default function NormDocumentEditor({ value, onChange }: { value: JSONContent; onChange: (document: JSONContent) => void }) {
  const [, setSelectionVersion] = useState(0);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ bulletList: false, orderedList: false, listItem: false, listKeymap: false, blockquote: false, codeBlock: false, horizontalRule: false, link: false, code: false, strike: false, heading: { levels: [2] } }),
      TextAlign.configure({ types: ["heading", "paragraph"], defaultAlignment: "left" }),
      NormBlockStyle,
      ReferenceMark,
      TextColorMark,
      Superscript.configure({ HTMLAttributes: { class: "norm-script" } }),
      Subscript.configure({ HTMLAttributes: { class: "norm-script" } }),
    ],
    content: value.type === "doc" ? value : emptyNormDocument,
    editorProps: { attributes: { class: "norm-document-prosemirror", "aria-label": "Texto de la norma" } },
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
    onSelectionUpdate: () => setSelectionVersion((version) => version + 1),
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = JSON.stringify(editor.getJSON());
    if (current !== JSON.stringify(value)) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return <div className="norm-document-loading">Preparando el documento…</div>;

  const blockType = editor.isActive("heading") ? "heading" : "paragraph";
  const attrs = editor.getAttributes(blockType);
  const indent = Math.min(4, Math.max(0, Number(attrs.indent) || 0));
  const barColor = barColorValues.includes(attrs.barColor) ? attrs.barColor : defaultBarColor;
  const showBar = Boolean(attrs.showBar);
  const preserveSelection = (event: MouseEvent<HTMLElement>) => event.preventDefault();
  const tool = (label: string, icon: ReactNode, active: boolean, action: () => void, disabled = false) => <button type="button" className={`norm-tool ${active ? "is-active" : ""}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled} onMouseDown={preserveSelection} onClick={action}>{icon}</button>;
  const updateBlock = (changes: Record<string, string | number | boolean>) => editor.chain().focus().updateAttributes(blockType, changes).run();

  return <div className="norm-rich-editor">
    <div className="norm-editor-toolbar" role="toolbar" aria-label="Formato del documento">
      {tool("Texto normal", <Pilcrow size={15} />, editor.isActive("paragraph"), () => editor.chain().focus().setParagraph().run())}
      {tool("Encabezado 20 pt", <Heading2 size={16} />, editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      <span className="norm-tool-divider" />
      {tool("Negrita", <Bold size={15} />, editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
      {tool("Cursiva", <Italic size={15} />, editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
      {tool("Subrayado", <Underline size={15} />, editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run())}
      {tool("Superíndice", <SuperscriptIcon size={15} />, editor.isActive("superscript"), () => editor.chain().focus().unsetSubscript().toggleSuperscript().run())}
      {tool("Subíndice", <SubscriptIcon size={15} />, editor.isActive("subscript"), () => editor.chain().focus().unsetSuperscript().toggleSubscript().run())}
      <span className="norm-tool-divider" />
      {tool("Alinear a la izquierda", <AlignLeft size={15} />, editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run())}
      {tool("Centrar", <AlignCenter size={15} />, editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run())}
      {tool("Alinear a la derecha", <AlignRight size={15} />, editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run())}
      {tool("Justificar", <AlignJustify size={15} />, editor.isActive({ textAlign: "justify" }), () => editor.chain().focus().setTextAlign("justify").run())}
      <span className="norm-tool-divider" />
      {tool("Mostrar u ocultar franja", showBar ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />, showBar, () => updateBlock({ showBar: !showBar }))}
      <ColorMenu label="Color de la franja" value={barColor} colors={barPalette} preserveSelection={preserveSelection} onSelect={(color) => updateBlock({ barColor: color })} />
      <span className="norm-tool-divider" />
      <ColorMenu label="Color de texto" value={editor.getAttributes("textColor").color ?? defaultTextColor} colors={palette} preserveSelection={preserveSelection} onSelect={(color) => editor.chain().focus().setMark("textColor", { color }).run()} />
      {tool("Reducir sangría", <IndentDecrease size={15} />, false, () => updateBlock({ indent: Math.max(0, indent - 1) }), indent === 0)}
      {tool("Aumentar sangría", <IndentIncrease size={15} />, false, () => updateBlock({ indent: Math.min(4, indent + 1) }), indent >= 4)}
      <span className="norm-tool-divider" />
      {tool("Marcar referencia con barras verticales", <span className="norm-reference-icon">|x|</span>, editor.isActive("reference"), () => editor.chain().focus().toggleMark("reference").run())}
      {tool("Deshacer", <Undo2 size={15} />, false, () => editor.chain().focus().undo().run())}
      {tool("Rehacer", <Redo2 size={15} />, false, () => editor.chain().focus().redo().run())}
    </div>
    <div className="norm-document-scroll"><div className="norm-document-page"><div className="norm-page-kicker">REGLAMENTO · E.E.S.T N°2</div><EditorContent editor={editor} /></div></div>
    <p className="norm-editor-help">Escribí como en un documento. Seleccioná texto para darle formato; usá Enter para crear el siguiente párrafo.</p>
  </div>;
}
