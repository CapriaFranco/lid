import { z } from "zod";

export const normTextPalette = [
  "#2B2827", "#F03732", "#B01610", "#E56A12", "#E5BE12", "#5ABF4C",
  "#57BA86", "#4CBFB9", "#4C69BF", "#171AE6", "#E01B84", "#0000FF",
] as const;
export const normBarPalette = ["#E01B84", "#0000FF"] as const;

const markSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bold") }).strict(),
  z.object({ type: z.literal("italic") }).strict(),
  z.object({ type: z.literal("underline") }).strict(),
  z.object({ type: z.literal("reference") }).strict(),
  z.object({ type: z.literal("textColor"), attrs: z.object({ color: z.enum(normTextPalette) }).strict() }).strict(),
  z.object({ type: z.literal("superscript") }).strict(),
  z.object({ type: z.literal("subscript") }).strict(),
]);

const inlineSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1).max(10_000), marks: z.array(markSchema).max(6).optional() }).strict(),
  z.object({ type: z.literal("hardBreak") }).strict(),
]);

const attrsSchema = z.object({
  level: z.literal(2).optional(),
  indent: z.number().int().min(0).max(4).optional(),
  showBar: z.boolean().optional(),
  barColor: z.enum(normBarPalette).optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
}).strict();

const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  attrs: attrsSchema.optional(),
  content: z.array(inlineSchema).max(4_000).optional(),
}).strict();

const headingSchema = z.object({
  type: z.literal("heading"),
  attrs: attrsSchema.extend({ level: z.literal(2) }),
  content: z.array(inlineSchema).max(4_000).optional(),
}).strict();

export const normDocumentSchema = z.object({
  type: z.literal("doc"),
  content: z.array(z.union([paragraphSchema, headingSchema])).max(1_500),
}).strict().superRefine((document, context) => {
  if (JSON.stringify(document).length > 250_000) {
    context.addIssue({ code: "custom", message: "El documento supera el tamaño permitido." });
  }

  const nodeCount = document.content.reduce((count, block) => count + 1 + (block.content?.length ?? 0), 1);
  if (nodeCount > 5_000) {
    context.addIssue({ code: "custom", message: "El documento tiene demasiados elementos." });
  }
});

export const normDocumentExchangeSchema = z.object({
  format: z.literal("vit-normas-document"),
  version: z.literal(1),
  title: z.string().trim().min(2).max(120),
  document: normDocumentSchema,
}).strict();

export type NormDocumentExchange = z.infer<typeof normDocumentExchangeSchema>;

export function getNormDocumentText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { type?: unknown; text?: unknown; content?: unknown };
  if (value.type === "text") return typeof value.text === "string" ? value.text : "";
  if (!Array.isArray(value.content)) return "";
  return value.content.map(getNormDocumentText).join("");
}

export function hasNormDocumentContent(document: unknown): boolean {
  if (!document || typeof document !== "object") return false;
  const content = (document as { content?: unknown }).content;
  return Array.isArray(content) && content.some((block) => getNormDocumentText(block).trim().length > 0);
}
