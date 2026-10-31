## MODIFIED Requirements

### Requirement: Envelope de estado seguro en tiempo real

El servicio SHALL usar RoomEnvelope con exactamente `sessionId`, `streamId`, `sequence`, `serverTime`, `remainingMs`, `reviewDurationSeconds`, `scoreboard` y `state`. `state` SHALL mantener los campos de SessionState REST de `session-rooms`, sin añadirle revisión configurada ni clasificación parcial. `sessionId` SHALL coincidir con `state.id` y `serverTime` con `state.serverTime`. `reviewDurationSeconds` SHALL informar la configuración inmutable de la sala; scoreboard SHALL ser la clasificación segura definida en `game-answers`. El envelope SHALL ser el payload de room:state, question:opened, question:closed, scoreboard:updated y game:finished, y el resultado de suscripción y comandos de control exitosos. La misma proyección segura SHALL aplicar a host y participantes, sin entidades completas, respuestas individuales, claves internas de imagen, credenciales ni preguntas futuras. El comprobante privado de answer:submit SHALL mantenerse fuera del envelope compartido.

#### Scenario: Estado inicial en espera
- **WHEN** el host o jugador se suscribe a una sala en espera
- **THEN** recibe state.phase WAITING, currentQuestion null, results null, remainingMs cero, su revisión configurada y una fila de cero por jugador en scoreboard

#### Scenario: Contrato REST conservado
- **WHEN** se consulta el mismo estado por REST
- **THEN** mantiene los campos de SessionState previamente definidos, sin stream, secuencia, remainingMs, reviewDurationSeconds ni scoreboard

#### Scenario: Datos de otra sala
- **WHEN** se produce cualquier envelope para una sala
- **THEN** su estado, pregunta, participantes, clasificación y resultados pertenecen exclusivamente a su sessionId

#### Scenario: Pregunta abierta con clasificación anterior
- **WHEN** se recibe un envelope mientras la pregunta actual está abierta
- **THEN** scoreboard refleja solo preguntas cerradas y no permite deducir los aciertos de la pregunta actual

### Requirement: Solución únicamente en revisión y fin seguro

question:closed SHALL publicarse únicamente para un estado confirmado en REVIEW, con la pregunta actual CLOSED, correctBoolean, closedAt y reviewEndsAt. SHALL respetar la duración de revisión configurada de 3 a 15 segundos, default 5, e incluir los puntajes acumulados confirmados de ese cierre. Una fase FINISHED SHALL tener currentQuestion null, remainingMs cero y resultados finales según session-rooms, con scoreboard igual a esos resultados y sin revelar preguntas nunca abiertas. Una recuperación existente que ya pasó la revisión SHALL publicar la fase actual y clasificación confirmada sin reproducir soluciones de revisiones omitidas. Puntuación, idempotencia y nuevos eventos no SHALL habilitar filtración de correctBoolean ni puntajes de preguntas OPEN.

#### Scenario: Cierre normal
- **WHEN** se confirma el cierre por vencimiento y comienza la revisión
- **THEN** se entregan room:state, question:closed y scoreboard:updated del mismo cambio, con la solución actual y reviewEndsAt igual a closedAt más la revisión configurada

#### Scenario: Siguiente apertura
- **WHEN** termina la revisión y abre la siguiente pregunta
- **THEN** la nueva entrega omite correctBoolean, contiene solo la nueva pregunta y conserva su duración completa de respuesta y clasificación de los cierres anteriores

#### Scenario: Finalización anticipada
- **WHEN** el host termina durante una pregunta abierta
- **THEN** se puntúa esa pregunta y se entrega clasificación final y game:finished, sin revisión artificial ni soluciones de preguntas pendientes

#### Scenario: Recuperación atrasada
- **WHEN** el servidor procesa por el mecanismo existente un plazo cuya revisión ya terminó
- **THEN** publica la siguiente pregunta o la finalización resultante y scoreboard actualizado, sin question:closed de una revisión histórica superada
