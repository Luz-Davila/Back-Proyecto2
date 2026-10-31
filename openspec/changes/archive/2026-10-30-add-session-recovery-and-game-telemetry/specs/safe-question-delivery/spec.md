## MODIFIED Requirements

### Requirement: Envelope de estado seguro en tiempo real

El servicio SHALL usar RoomEnvelope con exactamente `sessionId`, `streamId`, `sequence`, `serverTime`, `remainingMs`, `reviewDurationSeconds`, `scoreboard` y `state`. `state` SHALL mantener los campos de SessionState REST por id de `session-rooms`, sin añadirle revisión configurada ni clasificación parcial. `sessionId` SHALL coincidir con `state.id` y `serverTime` con `state.serverTime`. `reviewDurationSeconds` SHALL informar la configuración inmutable de la sala; scoreboard SHALL ser la clasificación segura definida en `game-answers`. El envelope SHALL ser el payload de room:state, question:opened, question:closed, scoreboard:updated y game:finished, el resultado de suscripción y comandos de control exitosos, y el cuerpo 200 de GET /sessions/{code}/state. La misma proyección segura SHALL aplicar a host y participantes por ambos transportes, sin entidades completas, respuestas individuales, claves internas de imagen, credenciales ni preguntas futuras. El comprobante privado de answer:submit SHALL mantenerse fuera del envelope compartido. La consulta HTTP por código no SHALL suscribir al cliente, incrementar sequence ni prometer continuidad de stream tras reiniciar; consultar por id SHALL conservar exclusivamente SessionState. Entre lecturas independientes pueden variar serverTime, remainingMs, URLs firmadas o una transición ya confirmada; no SHALL exigirse igualdad byte a byte entre solicitudes tomadas en instantes diferentes.

#### Scenario: Estado inicial en espera
- **WHEN** el host o jugador se suscribe a una sala en espera
- **THEN** recibe state.phase WAITING, currentQuestion null, results null, remainingMs cero, su revisión configurada y una fila de cero por jugador en scoreboard

#### Scenario: Contrato REST conservado
- **WHEN** se consulta el estado por GET /sessions/{id}
- **THEN** mantiene los campos de SessionState previamente definidos, sin stream, secuencia, remainingMs, reviewDurationSeconds ni scoreboard

#### Scenario: Datos de otra sala
- **WHEN** se produce cualquier envelope para una sala
- **THEN** su estado, pregunta, participantes, clasificación y resultados pertenecen exclusivamente a su sessionId

#### Scenario: Pregunta abierta con clasificación anterior
- **WHEN** se recibe un envelope mientras la pregunta actual está abierta
- **THEN** scoreboard refleja solo preguntas cerradas y no permite deducir los aciertos de la pregunta actual

#### Scenario: Recuperación HTTP y WebSocket compatibles
- **WHEN** el mismo usuario autorizado consulta por código y recupera la misma sala por room:join sin una transición entre lecturas
- **THEN** obtiene el mismo contrato de envelope, participante, pregunta y acumulado confirmado, aunque los campos temporales y las firmas se preparen en instantes distintos

#### Scenario: HTTP no crea suscripción
- **WHEN** un participante obtiene un snapshot por código y luego cambia la sala sin que haya realizado join o subscribe con ese socket
- **THEN** la consulta no habilita ningún broadcast ni altera la secuencia por sí misma
