## MODIFIED Requirements

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

### Requirement: Consulta autorizada y proyección segura

La API SHALL aceptar `GET /sessions/{id}` solo para el host o participantes registrados, incluyendo los de partidas finalizadas. La proyección SHALL contener `id`, `code`, `hostId`, `quizTitle`, `status`, `phase`, `questionDurationSeconds`, `currentIndex`, `questionsCount`, `startedAt`, `finishedAt`, `serverTime`, `participants`, `currentQuestion` y `results`. `phase` SHALL ser `WAITING`, `ANSWERING`, `REVIEW` o `FINISHED`. Los tiempos SHALL expresarse en ISO 8601 UTC o `null`. No SHALL revelar respuestas correctas de preguntas pendientes o abiertas ni preguntas futuras. `results` SHALL ser `null` hasta finalizar, y luego una lista de `{ participantId, totalScore, rank }`. Este estado REST no SHALL agregar scoreboard, reviewDurationSeconds ni respuestas individuales; los plazos efectivos de revisión SHALL reflejar la duración configurada y la clasificación parcial/configuración de revisión se entregan en el envelope WebSocket.

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
