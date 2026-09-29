# Plan del módulo de normas

## Estado actual

El panel tiene una sola entrada de Normas, permite crear categorías y administrar documentos con borrador/publicación. El editor ofrece una hoja de texto enriquecido; el visor público muestra solo documentos publicados mediante una única consulta agrupada por categorías.

## Propuesta de organización

- La página pública muestra las categorías una sola vez y permite abrir cada una para leer sus normas.
- Cada norma pertenece a una categoría, tiene un orden y un estado de publicación.
- El editor usa Tiptap como documento continuo: selección de texto, encabezados, negrita, cursiva, subrayado, alineación, sangría, barras de color, deshacer y rehacer.
- El visor representa encabezados de 20 pt, cuerpo de 12 pt y referencias con barras verticales. No se habilitan listas numeradas ni HTML libre.
- El documento se persiste como JSON estructurado con nodos y marcas permitidos. El servidor valida el esquema y el procedimiento almacenado vuelve a validarlo en Neon antes de guardar.
- Los cambios pueden guardarse como borrador o publicarse explícitamente; cada escritura registra auditoría.

## Pendiente

- Cargar y revisar el contenido oficial de esta edición. El PDF de referencia contiene material de una edición previa; sus reglas no se importan automáticamente.
- Evaluar imágenes, enlaces, historial y restauración cuando se conozca la necesidad editorial.
