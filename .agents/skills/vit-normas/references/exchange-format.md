# Formato de intercambio Normas LID v1

El editor de Normas LID importa y exporta un documento JSON autocontenido. El identificador `vit-normas-document` se conserva por compatibilidad técnica. Es un formato de transporte validado, no una API ni una escritura directa a la base de datos.

## Qué estructura admite el importador

El contrato representa una hoja documental con bloques de encabezado y párrafo. No admite un objeto de datos anidado con módulos como `metadata`, `teams_registry`, `fixture_structure`, listas de requisitos ni tablas. Esos módulos pueden servir como lista de comprobación para extraer y ordenar hechos, pero en el JSON final cada dato público debe convertirse en texto legible dentro de los párrafos bajo los encabezados pertinentes.

Por ejemplo, un registro de equipo o un fixture confirmado se expresa como sección y párrafos, no como arrays JSON aparte. No agregues propiedades personalizadas para intentar modelar tablas. Si el contenido completo supera los límites del documento, informa el problema en un archivo de auditoría y solicita una estrategia de división; no trunques ni cambies el contrato.

## Sobre exterior

```json
{
  "format": "vit-normas-document",
  "version": 1,
  "title": "Normas del torneo",
  "document": {
    "type": "doc",
    "content": []
  }
}
```

- `format` debe ser exactamente `vit-normas-document`.
- `version` debe ser el entero `1`.
- `title` admite entre 2 y 120 caracteres.
- `document` sigue el subconjunto JSON de Tiptap descrito abajo.
- El archivo no debe superar 1 MB al importarse. El documento no puede superar 250 KB serializado.
- No se admiten propiedades extra: un archivo no compatible debe corregirse, no importarse parcialmente.

## Bloques

El documento tiene `type: "doc"` y un arreglo `content` de hasta 1500 bloques `paragraph` o `heading`. Cada bloque puede tener `content` de hasta 4000 elementos en línea.

```json
{
  "type": "paragraph",
  "attrs": {
    "indent": 1,
    "showBar": true,
    "barColor": "#E01B84",
    "textAlign": "left"
  },
  "content": [
    { "type": "text", "text": "Cada equipo tendrá hasta " },
    { "type": "text", "text": "ocho" },
    { "type": "text", "text": " |8| jugadores.", "marks": [{ "type": "reference" }] }
  ]
}
```

`heading` usa `attrs.level: 2` y forma parte del índice público. Atributos disponibles para ambos tipos:

- `indent`: entero de 0 a 4.
- `showBar`: booleano para mostrar la franja vertical.
- `barColor`: solo `#E01B84` o `#0000FF`.
- `textAlign`: `left`, `center`, `right` o `justify`.
- `level`: valor `2` solo en `heading`.

Los atributos se pueden omitir; el editor y la página pública usan los valores predeterminados. No guardes un bloque vacío salvo que sea un renglón intencional para separar contenido.

## Contenido y marcas

Elementos en línea admitidos:

- Texto: `{ "type": "text", "text": "...", "marks": [...] }`.
- Salto de línea: `{ "type": "hardBreak" }`.

Marcas permitidas:

- `{ "type": "bold" }`, `{ "type": "italic" }`, `{ "type": "underline" }`.
- `{ "type": "reference" }` presenta el texto entre barras verticales claras.
- `{ "type": "superscript" }` y `{ "type": "subscript" }`.
- Color: `{ "type": "textColor", "attrs": { "color": "#F03732" } }`.

Paleta de texto:

| Nombre | Hex |
| --- | --- |
| Negro texto | `#2B2827` |
| Crítico | `#F03732` |
| Rojo | `#B01610` |
| Naranja | `#E56A12` |
| Amarillo | `#E5BE12` |
| Verde | `#5ABF4C` |
| Verde acento | `#57BA86` |
| Celeste | `#4CBFB9` |
| Azulado | `#4C69BF` |
| Azul | `#171AE6` |
| Fucsia institucional | `#E01B84` |
| Azul eléctrico | `#0000FF` |

Un texto individual admite hasta 10 000 caracteres y el documento hasta 5000 nodos. El límite serializado de documento es 250 KB. No agregues atributos a las marcas salvo `attrs.color` en `textColor`. Si una guía editorial menciona otros límites, prevalecen el validador actual de `lib/norm-document-schema.ts` y las validaciones del endpoint de guardado.

## Documento de ejemplo

```json
{
  "format": "vit-normas-document",
  "version": 1,
  "title": "Normas del torneo",
  "document": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 2, "indent": 0, "showBar": false, "barColor": "#E01B84", "textAlign": "left" },
        "content": [{ "type": "text", "text": "Inscripción y autorizaciones" }]
      },
      {
        "type": "paragraph",
        "attrs": { "indent": 1, "showBar": true, "barColor": "#0000FF", "textAlign": "left" },
        "content": [
          { "type": "text", "text": "Cada participante deberá presentar la autorización aprobada por la organización." }
        ]
      }
    ]
  }
}
```

Al importar, el documento reemplaza el borrador actual solo después de confirmación. El usuario debe guardar desde el panel para persistir/publicar; importar un archivo no cambia por sí solo el estado de publicación.

## Flujo para generar e importar

1. Usa `references/reestructurar-reglamento.prompt.md` junto con los PDF y demás fuentes disponibles. Genera el archivo completo `lid-normas-v1.json` y un informe separado de auditoría/cobertura; no mezcles el informe dentro del JSON.
2. En el panel privado, abre **Normas** y elige **Importar JSON**. Selecciona el archivo y confirma el reemplazo del borrador.
3. Revisa el documento en el editor y pulsa **Guardar documento**. La casilla **Publicar en el sitio** define si el contenido guardado queda visible públicamente.

El prompt descargable/copiable del panel debe producir el mismo contrato descrito aquí. No pegues el JSON de planificación multinivel como si fuera un archivo importable.
