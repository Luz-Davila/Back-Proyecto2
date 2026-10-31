## Why

El Gateway y el ciclo de vida ya publican preguntas seguras, pero aún no aceptan respuestas de jugadores ni calculan su puntuación. Los pasos 5 y 6 completan el juego con validación autoritativa, puntuación sin duplicados, competencia visible después de cada pregunta y tiempos configurables.

## What Changes

- Habilitar `answer:submit` por Socket.IO con `{ sessionQuestionId, choice }`, identidad del JWT y ack privado. Comprobar pertenencia, pregunta actual, estado OPEN, plazo del servidor y unicidad en BD; no crear endpoint REST de respuestas.
- Hacer idempotente la repetición del mismo `choice`: recuperar el comprobante original incluso después del cierre o finalización, sin insertar, cambiar respuestas ni repuntuar. Rechazar un intento de cambiar la elección.
- Confirmar inserción de la última respuesta, cierre y puntuación en una sola transacción. El servidor asigna `answeredAt` al validar bajo bloqueo; no acepta tiempos del cliente ni revela acierto/puntos en el comprobante.
- Puntuar al cerrar: incorrecto/omisión = 0, acierto = 1, primer acierto aceptado antes de 3000 ms desde `openedAt` = 3. Los aciertos empatados exactamente en el instante ganador comparten bono; si no hay acierto en esa ventana, no hay bono.
- Publicar `scoreboard:updated` después de cerrar cada pregunta, con acumulado de preguntas cerradas y puestos densos; incluir la tabla en el envelope existente para suscripción/consulta en tiempo real. Mantenerla sin cambios durante una pregunta abierta para no filtrar aciertos.
- Configurar en creación tiempos enteros e inmutables: respuesta 5–120 segundos (default 30) y revisión 3–15 (default 5). Conservar avance automático al terminar la revisión, restricciones del host y finalización anticipada.
- **BREAKING:** ampliar el contrato exacto de `RoomEnvelope` con `scoreboard` y `reviewDurationSeconds`, y sustituir la revisión fija por la configurada. Los campos de `SessionState` REST se mantienen; creación admite tiempos y defaults nuevos.
- Migrar sin recapturar quizzes, recalcular resultados históricos ni convertir puntajes heredados. Preservar duración de salas anteriores y usar revisión 5 para ellas; requerir una ventana de despliegue sin partidas en curso.

## Capabilities

### New Capabilities

- `game-answers`: recepción segura e idempotente de respuestas, comprobantes privados, puntuación 0/1/3 y clasificación acumulada de preguntas cerradas.

### Modified Capabilities

- `session-rooms`: creación con tiempos configurables/defaults y revisión visible según la configuración, sin nuevos campos en el estado REST.
- `session-lifecycle`: duración generalizada, revisión configurable, cierre/puntuación atómicos y resultados finales consistentes sin duplicar sumas.
- `session-realtime`: habilitar `answer:submit`, conservar acks uniformes y agregar notificaciones aisladas de clasificación.
- `safe-question-delivery`: ampliar envelope y eventos de clasificación sin revelar resultados de respuestas abiertas; sustituir referencias a revisión fija.

## Impact

- Servicios, reglas, persistencia y proyecciones de `src/sessions/`; contratos del Gateway, DTOs y OpenAPI de creación. La pertenencia exclusiva, autenticación JWT, snapshot en creación y modelo de una instancia se conservan.
- Nueva migración para rango de respuesta, duración de revisión y marca persistida de puntuación de pregunta. Se mantiene la restricción única de Answer y de resultado por jugador; no modificar migraciones previas ni puntajes históricos.
- Pruebas de dominio, BD y sockets: doble clic/dispositivos, plazos, permisos, bono, cierre concurrente, clasificación y rollback. Son aceptación de estos pasos, no una certificación de carga.
- Fuera de alcance: `GET /sessions/:code/state`, nuevos flujos de recuperación por código y demostración de reinicio real del VPS (paso 7); nueva telemetría para Grafana, pruebas de carga y registro del máximo concurrente demostrado (paso 8). No implementar frontend, desplegar infraestructura ni cambiar JWT.
