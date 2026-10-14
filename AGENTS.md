# Instrucciones del proyecto LID

## Producción y datos reales

El sistema está en producción y contiene datos reales. Tratar cualquier entorno o conexión de producción como información valiosa: no asumir que sus datos son de prueba, no ejecutar semillas ni limpiezas y no sustituir datos reales por ejemplos.

## Doble confirmación obligatoria para acciones sensibles

Antes de ejecutar una acción sensible, dañina o con impacto en producción, explicar en español claro qué acción se propone, sobre qué entorno o datos, qué cambiará y si puede perderse información o ser difícil revertirla. Después, exigir **dos confirmaciones explícitas y separadas del usuario** para esa acción concreta. Esta regla no es opcional.

1. Tras explicar el impacto, pedir la primera confirmación.
2. Después de recibirla, hacer únicamente las comprobaciones y preparativos no destructivos necesarios. Presentar el alcance final exacto y pedir una segunda confirmación explícita justo antes de ejecutar.
3. Ejecutar solo después de recibir ambas confirmaciones afirmativas. Si cambia el alcance, la acción o el entorno, volver a explicar y empezar de nuevo. El silencio, una respuesta ambigua o una autorización previa para otra tarea no cuentan como confirmación.

Requieren doble confirmación, entre otras:

- Borrar, truncar, reiniciar, limpiar o reemplazar datos; operaciones masivas de importación o edición.
- Alterar datos reales de equipos, integrantes, autorizaciones, códigos o cuentas administrativas desde herramientas externas al flujo normal del sitio.
- Aplicar migraciones o cambios de esquema a la base de datos de producción, especialmente si pueden eliminar o transformar datos.
- Cambiar credenciales, secretos, permisos, acceso administrativo o variables del entorno de producción.
- Publicar/desplegar en producción, fusionar cambios a `main` cuando ello active el despliegue, o ejecutar cualquier otra escritura externa con impacto real.
- Cualquier acción irreversible o cuyo alcance no pueda determinarse con seguridad.

Las consultas de solo lectura, el diagnóstico, la preparación de cambios locales reversibles y la revisión de código no requieren esta doble confirmación. No ejecutar la acción protegida mientras se esperan las confirmaciones; se puede avanzar con trabajo seguro e independiente.

## Cambios de base de datos

Antes de tocar datos reales, identificar explícitamente qué conexión y entorno se usarían. No usar comandos de reset, seed, cleanup o smoke test contra producción. Preparar primero el SQL o procedimiento y describir su efecto; ejecutar una migración o escritura en producción solo después de completar la doble confirmación.
