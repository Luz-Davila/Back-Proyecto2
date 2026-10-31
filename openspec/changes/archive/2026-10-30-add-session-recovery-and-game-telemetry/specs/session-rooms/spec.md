## ADDED Requirements

### Requirement: Consulta de snapshot actual por código

La API SHALL aceptar `GET /sessions/{code}/state` con JWT vigente, normalizando espacios exteriores y minúsculas del código con las mismas reglas de join. SHALL responder 200 con exactamente el `RoomEnvelope` de `safe-question-delivery`, sin wrapper ack HTTP, y cabecera `Cache-Control: private, no-store`. Solo el host o un participante persistido de esa sala SHALL acceder, también en FINISHED; conocer el código no SHALL autorizar la consulta ni registrar un jugador. Código mal formado SHALL producir 400 VALIDATION_ERROR; código válido inexistente o identidad ajena SHALL producir 404 SESSION_NOT_FOUND indistinguible; autenticación inválida SHALL producir 401 UNAUTHORIZED. SHALL conservar el formato REST de error `{ statusCode, code, message }`. La lectura SHALL usar un snapshot coherente, con puntos confirmados y tiempos vigentes, sin mutar participación, respuestas, resultados, reservas, secuencia pública o deadlines ni generar broadcasts. No SHALL incluir respuestas individuales. La nueva ruta no SHALL sustituir ni cambiar el shape de `GET /sessions/{id}`.

#### Scenario: Participante recupera por código normalizado
- **WHEN** un jugador ya registrado consulta con su JWT el código en minúsculas o con espacios exteriores
- **THEN** recibe el envelope de su sala con su mismo participante en state.participants y su puntaje acumulado en scoreboard, sin crear registros

#### Scenario: Host consulta sin jugar
- **WHEN** el host consulta por código una sala propia WAITING, IN_PROGRESS o FINISHED
- **THEN** recibe el estado autorizado y su clasificación sin agregarse como jugador

#### Scenario: Código ajeno o inexistente
- **WHEN** una cuenta sin acceso consulta un código válido existente o se consulta un código válido inexistente
- **THEN** recibe 404 SESSION_NOT_FOUND con el mismo shape, sin exponer participantes, estado ni solución

#### Scenario: Autenticación y formato inválidos
- **WHEN** falta un JWT válido o, después de autenticar, el código normalizado no tiene seis caracteres del alfabeto permitido
- **THEN** se devuelve respectivamente 401 UNAUTHORIZED o 400 VALIDATION_ERROR sin mutaciones

#### Scenario: Lectura mientras vence una pregunta
- **WHEN** el reloj alcanza closesAt antes de confirmarse el cierre y se consulta por código
- **THEN** se permite un snapshot aún OPEN con remainingMs cero, sin extender el plazo ni revelar correctBoolean; la consulta no ejecuta por sí misma una transición

#### Scenario: Consulta concurrente con salida o transición
- **WHEN** una lectura autorizada compite con salida, cierre o avance
- **THEN** representa un único estado coherente autorizado en su instante de lectura; no mezcla preguntas, participantes, stream o acumulados de distintas transiciones ni crea una suscripción

## MODIFIED Requirements

### Requirement: Join idempotente de un participante autenticado

La API SHALL aceptar `POST /sessions/join` con exactamente `{ "code": "<codigo>" }`, normalizando espacios exteriores y letras minúsculas. El usuario SHALL incorporarse con su perfil autenticado, sin aceptar `userId` ni rol suministrados por el cliente. El primer join SHALL permitirse únicamente en `WAITING`; el host SHALL NOT unirse como jugador a su propia sala. La respuesta SHALL ser 200 con `{ "participant": <participante>, "session": <estado> }`. El participante SHALL contener `id`, `sessionId`, `userId`, `displayName` y `joinedAt`. Tras autorizar al usuario, una participación existente por sala e identidad SHALL recuperarse en WAITING, IN_PROGRESS o FINISHED antes de evaluar restricciones de nueva incorporación, conservando id, joinedAt, respuestas y resultados. Recuperar una sala terminada no SHALL crear reservas activas, alterar una reserva de otra sala ni incrementar la secuencia o emitir otra transición. Si no existe participante, FINISHED SHALL seguir produciendo SESSION_FINISHED. La recuperación no SHALL depender del socket anterior, una caché de participantes ni identidad recibida en el cuerpo.

#### Scenario: Incorporación válida
- **WHEN** un usuario autenticado sin sala activa envía el código de una sala en espera
- **THEN** recibe 200 con su participante y el estado autorizado de esa sala

#### Scenario: Segundo join en la misma sala
- **WHEN** un participante existente repite el join en su sala WAITING, IN_PROGRESS o FINISHED, incluso con solicitudes simultáneas
- **THEN** recibe el mismo identificador y fecha de incorporación, sin duplicar ni reiniciar su registro, respuestas o puntaje

#### Scenario: Incorporación tardía
- **WHEN** un usuario no participante intenta incorporarse a una sala `IN_PROGRESS`
- **THEN** recibe 409 con `SESSION_NOT_JOINABLE` sin crear registros

#### Scenario: Sala finalizada
- **WHEN** un usuario sin participación previa intenta unirse a una sala FINISHED
- **THEN** recibe 409 con SESSION_FINISHED; los participantes anteriores conservan acceso de consulta y recuperación idempotente

#### Scenario: Host intenta jugar
- **WHEN** el host intenta incorporarse como participante a su propia sala
- **THEN** recibe 403 con `HOST_CANNOT_PARTICIPATE` y no se crea un jugador

#### Scenario: Código desconocido
- **WHEN** el usuario envía un código válido sin sala asociada
- **THEN** recibe 404 con `SESSION_NOT_FOUND`

#### Scenario: Recuperación histórica con otra sala activa
- **WHEN** un participante de una sala FINISHED tiene una reserva vigente en otra sala y recupera la anterior
- **THEN** obtiene su participante y resultados históricos sin modificar ni liberar la reserva de la sala activa

### Requirement: Consulta autorizada y proyección segura

La API SHALL aceptar `GET /sessions/{id}` solo para el host o participantes registrados, incluyendo los de partidas finalizadas. La proyección SHALL contener `id`, `code`, `hostId`, `quizTitle`, `status`, `phase`, `questionDurationSeconds`, `currentIndex`, `questionsCount`, `startedAt`, `finishedAt`, `serverTime`, `participants`, `currentQuestion` y `results`. `phase` SHALL ser `WAITING`, `ANSWERING`, `REVIEW` o `FINISHED`. Los tiempos SHALL expresarse en ISO 8601 UTC o `null`. No SHALL revelar respuestas correctas de preguntas pendientes o abiertas ni preguntas futuras. `results` SHALL ser `null` hasta finalizar, y luego una lista de `{ participantId, totalScore, rank }`. Este estado REST por id no SHALL agregar scoreboard, reviewDurationSeconds ni respuestas individuales; los plazos efectivos de revisión SHALL reflejar la duración configurada. La clasificación parcial/configuración de revisión SHALL entregarse fuera de SessionState, en el envelope WebSocket y en el de la consulta HTTP por código definidos en safe-question-delivery.

#### Scenario: Consulta por un usuario ajeno
- **WHEN** un usuario ajeno consulta una sala o se consulta un identificador inexistente
- **THEN** recibe 404 con `SESSION_NOT_FOUND` sin exponer su estado

#### Scenario: Pregunta abierta
- **WHEN** el host o un participante consulta una sala durante una pregunta abierta
- **THEN** `currentQuestion` contiene `id`, `position`, `statement`, `imageUrl`, `status`, `openedAt`, `closesAt`, `closedAt` y `reviewEndsAt`, pero no contiene `correctBoolean` ni preguntas futuras

#### Scenario: Revisión de respuesta
- **WHEN** el host o un participante consulta durante el período configurado de revisión
- **THEN** `phase` es `REVIEW`, `currentQuestion` incluye además `correctBoolean` y refleja el plazo de revisión de esa sala

#### Scenario: Sala en espera o finalizada
- **WHEN** un usuario autorizado consulta una sala WAITING o FINISHED
- **THEN** `currentQuestion` es null, y el estado y resultados corresponden a esa fase sin exponer preguntas pendientes
