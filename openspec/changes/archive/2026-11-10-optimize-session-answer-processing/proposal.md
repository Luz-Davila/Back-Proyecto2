## Why

La prueba local de 30 jugadores y 30 preguntas guardó 900/900 respuestas, pero ejecutó 43.880 consultas, 2.700 snapshots completos durante los envíos y 27.900 actualizaciones de puntajes. Con 50 ms artificiales por consulta, cuatro respuestas recibidas a tiempo esperaron en cola hasta superar su cierre y fueron rechazadas; el despliegue también mostró rechazos, aunque no se aisló allí la latencia de BD.

## What Changes

- Introducir una ruta transaccional corta para respuestas normales e idempotentes, sin cargar todo el historial ni preparar snapshots públicos que no cambian.
- Persistir únicamente cambios reales del ciclo de vida y los puntajes de la pregunta recién calificada, usando escrituras por lote; no reescribir puntajes previos al avanzar o finalizar.
- **BREAKING, semántica temporal:** para respuestas futuras, fijar `answeredAt` con el reloj del servidor al admitir el comando autenticado y validado en el servicio, antes de consultar BD o esperar turno. Las respuestas admitidas antes del plazo deben procesarse antes del cierre automático correspondiente. Esto sustituye explícitamente la validación temporal dentro del bloqueo exigida por la spec vigente y cambia la referencia del bono de rapidez; no cambia payloads ni recalifica datos históricos.
- Conservar autenticación vigente, pertenencia, unicidad, idempotencia, bloqueos de BD, cierre/puntuación atómicos, rollback y notificaciones privadas/públicas existentes. Mantener los tipos booleano y cuatro opciones, múltiples opciones válidas y rachas que ya soporta el código.
- Incorporar al repositorio un benchmark local reproducible de 30×30, presupuestos de consultas/latencia y controles de latencia artificial, con integridad y limpieza verificables, sin interfaces ni servicios externos.
- Mantener despliegue de una instancia. No introducir Redis, réplicas, nuevos endpoints, ajustes de timeout del frontend ni cambios de Railway/Supabase.

## Capabilities

### New Capabilities

Ninguna: se modifican capacidades existentes.

### Modified Capabilities

- `game-answers`: admisión temporal confiable antes de la cola, persistencia acotada y preservación de permisos/idempotencia para los tipos ya implementados.
- `session-lifecycle`: orden entre respuestas pendientes y cierre automático, persistencia incremental y conservación de deadlines y resultados.
- `game-telemetry`: medición de la espera efectiva con la nueva admisión, sin duplicar observaciones ni usar telemetría para decidir la partida.
- `multiuser-verification`: comparación reproducible de consultas, filas escritas, tiempos de cola/ack e integridad para 30 usuarios y 30 preguntas.

## Impact

- Backend: `src/sessions/session-answers.service.ts`, `sessions.repository.ts`, `session-coordinator.ts`, reglas temporales/cierre, ciclo de vida y sus tests; posiblemente un coordinador interno de admisiones por pregunta.
- Verificación: `test/support`, tests de integración/Socket.IO, ejecutor de rendimiento y documentación de resultados. Las credenciales, JWT, SQL con valores y resultados temporales sin sanitizar no se versionarán.
- PostgreSQL/TypeORM: consultas selectivas, conteos y actualizaciones parametrizadas por lote sobre tablas e índices existentes; no se prevé una migración de esquema.
- Compatibilidad externa: mismas rutas, comandos, envelopes, errores y comprobantes; cambia deliberadamente qué timestamp autoritativo decide admisión y rapidez de respuestas nuevas. La spec de payloads se alineará con la opción múltiple ya desplegada, sin introducir formatos nuevos.
- Alcance de esta fase: propuesta, diseño, deltas y tareas para revisión. La aplicación requiere un pedido posterior según las instrucciones locales de OpenSpec; no incluye push, despliegue ni pruebas remotas.
