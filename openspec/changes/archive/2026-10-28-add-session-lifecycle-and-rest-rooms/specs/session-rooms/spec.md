## Purpose

Permitir crear y consultar salas autenticadas por REST, con incorporación segura de jugadores, códigos únicos y exclusión de participación simultánea en varias salas activas.

## ADDED Requirements

### Requirement: Creación autenticada con copia del cuestionario

La API SHALL aceptar `POST /sessions` con exactamente `{ "quizId": "<uuid>", "questionDurationSeconds": 15 | 30 }`. El usuario autenticado SHALL ser dueño del cuestionario y convertirse en host, no en participante. La creación SHALL responder 201 con una proyección de estado de la sala en `WAITING`, `currentIndex = -1`, y una copia consistente del título y preguntas ordenadas, incluyendo enunciados, respuestas correctas y claves de imagen. No SHALL depender de futuras ediciones del cuestionario original. La duración SHALL ser obligatoria e inmutable durante la sala.

#### Scenario: Creación válida
- **WHEN** el dueño crea una sala con su cuestionario y duración de 15 segundos
- **THEN** recibe 201 con identificador, código único, duración 15 y estado `WAITING`, sin participante ni resultado para el host

#### Scenario: Sin autenticación
- **WHEN** una solicitud de crear, consultar, unirse o salir no tiene un JWT válido
- **THEN** recibe 401 y no se modifica la base de datos

#### Scenario: Cuestionario ajeno o inexistente
- **WHEN** el usuario intenta crear una sala con un cuestionario que no posee o que no existe
- **THEN** recibe 404 con `QUIZ_NOT_FOUND` y no se crea la sala

#### Scenario: Configuración inválida
- **WHEN** la duración falta, es texto, no es 15 ni 30, el identificador es inválido o se envían campos adicionales
- **THEN** recibe 400 con `VALIDATION_ERROR` y no se crea la sala

#### Scenario: Copia independiente
- **WHEN** se edita o elimina el cuestionario después de crear la sala
- **THEN** la sala mantiene su título y las copias de sus preguntas, con referencia nula al original eliminado

### Requirement: Códigos únicos y salas aisladas

Cada sala SHALL tener un código único de seis caracteres del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. El código SHALL permanecer reservado también al finalizar, evitando reutilización ambigua. Una colisión durante la generación SHALL reintentarse sin devolver una sala duplicada ni un error de base de datos al cliente. Si se agotan los reintentos SHALL devolverse 503 con `ROOM_CODE_UNAVAILABLE`.

#### Scenario: Dos creaciones simultáneas
- **WHEN** se crean dos salas concurrentemente
- **THEN** obtienen identificadores y códigos distintos y sus participantes y copias quedan separados

#### Scenario: Colisión de código
- **WHEN** un código generado ya pertenece a otra sala
- **THEN** se genera otro código y no se modifica la sala existente

### Requirement: Join idempotente de un participante autenticado

La API SHALL aceptar `POST /sessions/join` con exactamente `{ "code": "<codigo>" }`, normalizando espacios exteriores y letras minúsculas. El usuario SHALL incorporarse con su perfil autenticado, sin aceptar `userId` ni rol suministrados por el cliente. El primer join SHALL permitirse únicamente en `WAITING`; el host SHALL NOT unirse como jugador a su propia sala. La respuesta SHALL ser 200 con `{ "participant": <participante>, "session": <estado> }`. El participante SHALL contener `id`, `sessionId`, `userId`, `displayName` y `joinedAt`.

#### Scenario: Incorporación válida
- **WHEN** un usuario autenticado sin sala activa envía el código de una sala en espera
- **THEN** recibe 200 con su participante y el estado autorizado de esa sala

#### Scenario: Segundo join en la misma sala
- **WHEN** un participante existente repite el join en su sala `WAITING` o `IN_PROGRESS`, incluso con solicitudes simultáneas
- **THEN** recibe el mismo identificador y fecha de incorporación, sin duplicar ni reiniciar su registro

#### Scenario: Incorporación tardía
- **WHEN** un usuario no participante intenta incorporarse a una sala `IN_PROGRESS`
- **THEN** recibe 409 con `SESSION_NOT_JOINABLE` sin crear registros

#### Scenario: Sala finalizada
- **WHEN** cualquier usuario intenta unirse a una sala `FINISHED`, aunque participara previamente
- **THEN** recibe 409 con `SESSION_FINISHED`; los participantes anteriores conservan acceso de consulta

#### Scenario: Host intenta jugar
- **WHEN** el host intenta incorporarse como participante a su propia sala
- **THEN** recibe 403 con `HOST_CANNOT_PARTICIPATE` y no se crea un jugador

#### Scenario: Código desconocido
- **WHEN** el usuario envía un código válido sin sala asociada
- **THEN** recibe 404 con `SESSION_NOT_FOUND`

### Requirement: Una sola sala activa por jugador

El sistema SHALL impedir que un jugador pertenezca a dos salas activas, considerando activas `WAITING` e `IN_PROGRESS`. La garantía SHALL mantenerse con joins simultáneos a salas distintas, sin depender de la conexión del jugador. Finalizar una sala o abandonarla durante la espera SHALL liberar la exclusividad sin borrar historial de partidas terminadas. Esta restricción corresponde a participación como jugador; no establece un límite nuevo sobre salas dirigidas por un host.

#### Scenario: Join a otra sala activa
- **WHEN** un jugador de una sala activa intenta incorporarse a otra
- **THEN** recibe 409 con `ALREADY_IN_ACTIVE_SESSION` y permanece únicamente en la primera

#### Scenario: Joins simultáneos a salas distintas
- **WHEN** el mismo usuario intenta incorporarse simultáneamente a dos salas en espera
- **THEN** solo un join tiene éxito y el otro devuelve `ALREADY_IN_ACTIVE_SESSION`

#### Scenario: Desconexión durante la partida
- **WHEN** un participante se desconecta y luego intenta entrar en otra sala activa
- **THEN** se conserva su reserva y recibe `ALREADY_IN_ACTIVE_SESSION`

#### Scenario: Partida anterior finalizada
- **WHEN** finaliza la sala del jugador y este se une a otra sala en espera
- **THEN** el join tiene éxito y su participación y resultados anteriores siguen disponibles

### Requirement: Salida explícita durante la espera

La API SHALL aceptar `DELETE /sessions/{id}/participants/me` para abandonar una sala `WAITING` y liberar la exclusividad del jugador, respondiendo 204 sin cuerpo. Repetir una salida en espera SHALL ser un éxito sin efectos adicionales. Una salida en `IN_PROGRESS` o `FINISHED` SHALL devolver 409 con `SESSION_NOT_LEAVABLE` sin borrar participación ni respuestas. El host SHALL recibir 403 con `HOST_CANNOT_PARTICIPATE` en esta operación, porque no es jugador.

#### Scenario: Abandono en espera
- **WHEN** un participante abandona una sala `WAITING`
- **THEN** se elimina su incorporación de espera, se libera su exclusividad y puede entrar en otra sala

#### Scenario: Salida y arranque simultáneos
- **WHEN** compiten una salida y el inicio de una misma sala
- **THEN** se serializan: o sale antes y el inicio evalúa el nuevo número de jugadores, o inicia antes y la salida es rechazada sin alterar la lista fijada

### Requirement: Consulta autorizada y proyección segura

La API SHALL aceptar `GET /sessions/{id}` solo para el host o participantes registrados, incluyendo los de partidas finalizadas. La proyección SHALL contener `id`, `code`, `hostId`, `quizTitle`, `status`, `phase`, `questionDurationSeconds`, `currentIndex`, `questionsCount`, `startedAt`, `finishedAt`, `serverTime`, `participants`, `currentQuestion` y `results`. `phase` SHALL ser `WAITING`, `ANSWERING`, `REVIEW` o `FINISHED`. Los tiempos SHALL expresarse en ISO 8601 UTC o `null`. No SHALL revelar respuestas correctas de preguntas pendientes o abiertas ni preguntas futuras. `results` SHALL ser `null` hasta finalizar, y luego una lista de `{ participantId, totalScore, rank }`.

#### Scenario: Consulta por un usuario ajeno
- **WHEN** un usuario ajeno consulta una sala o se consulta un identificador inexistente
- **THEN** recibe 404 con `SESSION_NOT_FOUND` sin exponer su estado

#### Scenario: Pregunta abierta
- **WHEN** el host o un participante consulta una sala durante una pregunta abierta
- **THEN** `currentQuestion` contiene `id`, `position`, `statement`, `imageUrl`, `status`, `openedAt`, `closesAt`, `closedAt` y `reviewEndsAt`, pero no contiene `correctBoolean` ni preguntas futuras

#### Scenario: Revisión de respuesta
- **WHEN** el host o un participante consulta durante los cinco segundos de revisión
- **THEN** `phase` es `REVIEW`, `currentQuestion` incluye además `correctBoolean` y refleja el plazo de revisión

#### Scenario: Sala en espera o finalizada
- **WHEN** un usuario autorizado consulta una sala `WAITING` o `FINISHED`
- **THEN** `currentQuestion` es `null`, y el estado y los resultados corresponden a esa fase sin exponer preguntas pendientes

### Requirement: Errores REST estables

Los errores de los endpoints nuevos SHALL usar exactamente `{ "statusCode": <numero>, "code": "<codigo-estable>", "message": "<descripcion>" }`, sin stack ni detalles SQL. Los errores de autenticación SHALL usar `UNAUTHORIZED`; los de formato `VALIDATION_ERROR`. Los errores de dominio SHALL mantener sus códigos al reutilizarse desde futuros transportes, sin modificar las respuestas de endpoints existentes.

#### Scenario: Error de dominio conocido
- **WHEN** un join viola la exclusividad entre salas activas
- **THEN** se devuelve 409 con `code = ALREADY_IN_ACTIVE_SESSION` y un mensaje comprensible, sin información de otros jugadores

#### Scenario: Error inesperado
- **WHEN** ocurre un fallo interno no clasificado
- **THEN** se devuelve 500 con `INTERNAL_ERROR` sin filtrar credenciales, consultas ni trazas
