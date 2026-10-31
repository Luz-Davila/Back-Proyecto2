# session-rooms Specification

## Purpose

Permitir crear y consultar salas autenticadas por REST, con incorporación segura de jugadores, códigos únicos y exclusión de participación simultánea en varias salas activas.

## Requirements

### Requirement: Creación autenticada con copia del cuestionario

La API SHALL aceptar `POST /sessions` con exactamente los campos permitidos `quizId`, `questionDurationSeconds` y `reviewDurationSeconds`. `quizId` SHALL ser UUID obligatorio; la duración de respuesta SHALL ser un entero entre 5 y 120 segundos inclusive, con default 30 solo si se omite; la revisión SHALL ser un entero entre 3 y 15 inclusive, con default 5 solo si se omite. No SHALL convertir texto, null ni booleanos a duraciones válidas. El usuario autenticado SHALL ser dueño del cuestionario y convertirse en host, no en participante. La creación SHALL responder 201 con una proyección de estado de la sala en `WAITING`, `currentIndex = -1`, y una copia consistente del título y preguntas ordenadas, incluyendo enunciados, respuestas correctas y claves de imagen. No SHALL depender de futuras ediciones del cuestionario original. Ambas duraciones SHALL quedar fijas para toda la sala y no SHALL existir operación para modificarlas después de crearla. Las salas previas SHALL conservar su duración de respuesta y recibir revisión 5 sin alterar historial.

#### Scenario: Creación válida
- **WHEN** el dueño crea una sala con su cuestionario y duración de respuesta 15 y revisión 7
- **THEN** recibe 201 con identificador, código único, respuesta 15 y estado WAITING, sin participante ni resultado para el host, y la sala conserva revisión 7

#### Scenario: Sin autenticación
- **WHEN** una solicitud de crear, consultar, unirse o salir no tiene un JWT válido
- **THEN** recibe 401 y no se modifica la base de datos

#### Scenario: Cuestionario ajeno o inexistente
- **WHEN** el usuario intenta crear una sala con un cuestionario que no posee o que no existe
- **THEN** recibe 404 con `QUIZ_NOT_FOUND` y no se crea la sala

#### Scenario: Configuración inválida
- **WHEN** una duración enviada es texto, null, booleana, decimal o fuera de su rango, el identificador es inválido o se envían campos adicionales
- **THEN** recibe 400 con `VALIDATION_ERROR` y no se crea la sala

#### Scenario: Copia independiente
- **WHEN** se edita o elimina el cuestionario después de crear la sala
- **THEN** la sala mantiene su título y las copias de sus preguntas, con referencia nula al original eliminado

#### Scenario: Duraciones omitidas
- **WHEN** el dueño envía solo un quizId válido
- **THEN** se crea la sala con respuesta 30 y revisión 5

#### Scenario: Límites y compatibilidad
- **WHEN** se crean salas con respuesta 5 o 120, revisión 3 o 15, o los antiguos cuerpos de respuesta 15/30 sin revisión
- **THEN** se aceptan los límites y los cuerpos anteriores conservan revisión 5 sin cambiar el snapshot

### Requirement: Códigos únicos y salas aisladas

Cada sala SHALL tener un código único de seis caracteres del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. El código SHALL permanecer reservado también al finalizar, evitando reutilización ambigua. Una colisión durante la generación SHALL reintentarse sin devolver una sala duplicada ni un error de base de datos al cliente. Si se agotan los reintentos SHALL devolverse 503 con `ROOM_CODE_UNAVAILABLE`.

#### Scenario: Dos creaciones simultáneas
- **WHEN** se crean dos salas concurrentemente
- **THEN** obtienen identificadores y códigos distintos y sus participantes y copias quedan separados

#### Scenario: Colisión de código
- **WHEN** un código generado ya pertenece a otra sala
- **THEN** se genera otro código y no se modifica la sala existente

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

### Requirement: Errores REST estables

Los errores de los endpoints nuevos SHALL usar exactamente `{ "statusCode": <numero>, "code": "<codigo-estable>", "message": "<descripcion>" }`, sin stack ni detalles SQL. Los errores de autenticación SHALL usar `UNAUTHORIZED`; los de formato `VALIDATION_ERROR`. Los errores de dominio SHALL mantener sus códigos al reutilizarse desde futuros transportes, sin modificar las respuestas de endpoints existentes.

#### Scenario: Error de dominio conocido
- **WHEN** un join viola la exclusividad entre salas activas
- **THEN** se devuelve 409 con `code = ALREADY_IN_ACTIVE_SESSION` y un mensaje comprensible, sin información de otros jugadores

#### Scenario: Error inesperado
- **WHEN** ocurre un fallo interno no clasificado
- **THEN** se devuelve 500 con `INTERNAL_ERROR` sin filtrar credenciales, consultas ni trazas

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
