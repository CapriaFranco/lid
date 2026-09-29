---
name: vit-normas
description: Reestructura y corrige reglamentos del Torneo Interno de Vóley E.E.S.T. N°2 a partir de los PDF V25/V24 y V26, aplicando el orden temático acordado en la conversación de Gemini y generando JSON importable para el editor de Normas LID (versión 1). Usala cada vez que el usuario pida revisar, ordenar, corregir, migrar o preparar las normas de LID, aunque solo mencione los PDF o el reglamento.
compatibility: Requiere leer los PDF de origen y, para importar, acceder al proyecto LID. No requiere claves ni acceso directo a Neon.
metadata:
  project: lid-2026
  format: vit-normas-document/v1
---

# Skill: reestructuración editorial de Normas LID

Convertí el contenido de los documentos fuente del torneo en un reglamento coherente, corregido y listo para importar en el editor de Normas LID. La salida principal de una reestructuración completa es un archivo JSON válido para `vit-normas-document` versión 1 (identificador técnico conservado por compatibilidad), acompañado de un breve informe editorial y una lista de conflictos pendientes.

## Fuentes del proyecto

- `VIT-Pormenorizado-2025.pdf`: referencia de estilo, tono, continuidad y organización previa.
- `VIT-Pormenorizado-2026.pdf`: fuente de propuestas y cambios de la edición 2026; contiene desajustes editoriales señalados por el usuario.
- Texto pegado de la conversación con Gemini: aporta diagnóstico y una propuesta de organización temática. Su esquema sirve como directriz estructural acordada, pero sus datos, correcciones y redacciones no constituyen por sí solos reglas aprobadas.
- Notas e instrucciones directas del usuario: determinan qué cambios fueron aprobados. Si una nota del usuario posterior contradice un PDF, marcar la discrepancia y pedir definición; no suponer.

Al iniciar, busca los PDF en la raíz del proyecto. Si falta uno, está ilegible o no se pudo extraer su texto, dilo explícitamente y trabaja solo con fuentes disponibles; nunca finjas haber contrastado páginas que no pudiste leer.

## Estructura temática acordada

Reordena por etapa y tema, evitando que requisitos administrativos reaparezcan mezclados en las reglas del partido. Usa estos apartados solo cuando las fuentes tengan contenido para ellos:

1. **Marco general y requisitos de participación**: finalidad, elegibilidad, asistencia y situación académica.
2. **Inscripción y documentación**: registro, autorizaciones, responsables, costos y fechas de entrega.
3. **Equipos y formato de la competencia**: composición, titulares, suplentes, líbero, indumentaria, sistemas y sets/puntuación por ciclo.
4. **Organización y cronograma**: organización, árbitros, colaboradores, fixture, horarios y llamados.
5. **Reglas de juego**: saque, rotaciones, posiciones, toques, red, tiempos y cambios.
6. **Puntualidad, incumplimientos y disciplina**: tolerancia, W.O., tarjetas, conducta y sanciones.
7. **Anexos operativos**: nóminas, planillas, fixture u otros materiales de consulta que no sean reglas narrativas.

Puedes ajustar nombres, fusionar apartados estrechamente relacionados o subdividirlos si mejora la lectura, pero no cambies la secuencia general. No crees encabezados vacíos. En el índice deben aparecer solo encabezados reales del documento.

## Reglas de fidelidad normativa

1. Extrae primero los hechos y reglas en una matriz interna: tema, texto fuente, documento/página (si se puede obtener), versión/fecha, conflicto, confianza.
2. Distingue errores de escritura de cambios de política. Corrige tildes, gramática, puntuación, mayúsculas y erratas obvias. No cambies cifras, requisitos, sanciones, alcance, responsables, plazos, excepciones ni obligación/prohibición al corregir estilo.
3. Usa V25 como modelo de tono formal e institucional y de coherencia, no como sustituto automático de la edición vigente. Integra cambios de V26 donde no contradigan una decisión vigente confirmada.
4. Ante diferencias V25/V24 frente a V26, conserva ambas variantes en una lista de conflictos fuera del documento final y deja fuera del JSON la regla disputada hasta confirmación. No ocultes la incertidumbre con una redacción conciliadora.
5. No incorpores al JSON recomendaciones factuales originadas solo en Gemini, como porcentajes, cantidad de materias, precios, fechas, horarios, duración, reglas técnicas o sanciones. Una recomendación organizativa puede guiar el orden porque el usuario pidió esa estructura; no es evidencia normativa.
6. Mantén el español rioplatense claro, formal, conciso e impersonal. Evita lenguaje coloquial, notas personales, frases incompletas y tono grandilocuente. Expande abreviaturas poco claras la primera vez cuando las fuentes permitan hacerlo (por ejemplo, “walkover (W.O.)”).
7. No añadas una portada, prólogo o conclusión que no tenga respaldo o solicitud. No inventes aprobaciones institucionales.

## Diseño y JSON de salida

Lee [references/exchange-format.md](references/exchange-format.md) antes de generar JSON. El contrato de aplicación está en `lib/norm-document-schema.ts`; debe tratarse como fuente técnica de verdad si difiere de ejemplos narrativos.

- La respuesta de reestructuración completa debe crear un `.json` descargable/importable, no dejar solo un ejemplo abreviado en el chat.
- El esquema multinivel de un prompt puede usarse como lista de extracción, pero no es compatible con el importador. Convierte sus temas y datos verificados en encabezados y párrafos del documento único; conserva el sobre exacto de `exchange-format.md`.
- Sobre exterior exacto: `format: "vit-normas-document"`, `version: 1`, `title` y `document`.
- El documento es una hoja con bloques Tiptap `heading` nivel 2 y `paragraph`; nada de HTML libre, listas nativas, scripts, enlaces, atributos arbitrarios ni colores fuera de paleta.
- Usa encabezados para secciones sustantivas: alimentan el índice. No conviertas cada frase resaltada en encabezado.
- Aplica formato sobrio según el PDF y el diseño de la app: cuerpo 12 pt, encabezados 20 pt, franjas fucsia/azul, sangrías de 0 a 4, alineación y marcas admitidas. No añadas decoración sin función.
- Respeta colores de franja `#E01B84`/`#0000FF` y paleta de texto del contrato. Usa la marca `reference` para un segmento entre barras verticales cuando sea apropiado y esté respaldado por el estilo de origen; no fuerces esa notación a todo número.
- Si se necesita una aclaración o aprobación, no la insertes en el texto normativo ni en el JSON; reportala aparte.

## Flujo de uso del prompt y la importación

Usa [references/reestructurar-reglamento.prompt.md](references/reestructurar-reglamento.prompt.md) junto con los PDFs y las instrucciones vigentes. El resultado debe incluir `lid-normas-v1.json` y un informe de auditoría separado. En el panel privado, abre **Normas**, importa ese JSON, confirma el reemplazo, revisa el contenido y pulsa **Guardar documento**. La importación solo reemplaza el borrador en el editor; guardar persiste los cambios y la casilla de publicación controla su visibilidad pública.

## Validación obligatoria antes de entregar

1. Valida el archivo completo contra `normDocumentExchangeSchema` (o con el validador de la aplicación); no confíes en una revisión visual del JSON.
2. Verifica el formato exterior, versión, tipos de bloque, marcas, atributos, colores y límites de tamaño/nodos/caracteres.
3. Recorre el PDF página por página y comprueba que cada regla vigente aparece exactamente una vez en el lugar lógico o que está enumerada como conflicto/decisión pendiente. No elimines una regla porque parezca repetida sin confirmar equivalencia.
4. Revisa ortografía y que no queden fragmentos, encabezados vacíos, texto de Gemini, comentarios editoriales o marcadores de trabajo dentro del reglamento.
5. Entrega: enlace al JSON, resumen de cambios de redacción/orden, conflictos y datos pendientes de confirmación, y estado de validación. No digas que se importó, guardó o publicó: eso requiere una acción separada en la aplicación.

## Prompt reutilizable

Para una petición completa, usa la plantilla [references/reestructurar-reglamento.prompt.md](references/reestructurar-reglamento.prompt.md). La plantilla pide comparar los PDF, reordenar, corregir y producir el JSON importable.
