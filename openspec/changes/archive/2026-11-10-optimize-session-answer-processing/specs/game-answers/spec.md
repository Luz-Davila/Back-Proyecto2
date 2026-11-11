## MODIFIED Requirements

### Requirement: Envío autenticado y comprobante privado

El servicio SHALL aceptar `answer:submit` únicamente por Socket.IO con callback ack. SHALL conservar los campos de payload ya implementados: `sessionQuestionId` UUID, `choice` booleano para preguntas booleanas y `choiceIndex` entero entre 0 y 3 para preguntas de cuatro opciones; la elección relevante SHALL determinarse por el tipo persistido de la pregunta, sin introducir formatos nuevos ni endurecer el tratamiento de campos de elección irrelevantes respecto al contrato desplegado. SHALL obtener usuario y participante desde el JWT y pertenencia persistida, sin aceptar `sessionId`, `userId`, `participantId`, `answeredAt`, `receivedAt`, `score`, rol ni campos adicionales en el payload. SHALL exigir acceso vigente en cada envío y aplicar `VALIDATION_ERROR` a cuerpos inválidos o coerciones de la elección relevante. En éxito SHALL devolver `{ ok: true, data: { answer: <AnswerReceipt> } }`; `AnswerReceipt` SHALL contener exactamente `id`, `sessionQuestionId`, `answeredAt` UTC y la elección persistida: `choice` para booleanas o `choiceIndex` para cuatro opciones. No SHALL incluir puntaje, solución, otros jugadores ni un estado de sala dentro de este comprobante. `answer:ack` SHALL designar este callback, no un evento separado ni broadcast. No SHALL agregarse un endpoint HTTP de respuestas.

#### Scenario: Respuesta válida
- **WHEN** un participante envía una elección válida para el tipo de la pregunta actual abierta y su admisión cumple la ventana temporal
- **THEN** recibe el comprobante de una respuesta persistida con identidad y fecha asignadas por el servidor

#### Scenario: Suplantación o datos calculados por cliente
- **WHEN** el cuerpo incluye otra identidad, puntaje, timestamp o una elección relevante de tipo o rango inválido
- **THEN** recibe `VALIDATION_ERROR` y no se crea ni modifica respuesta alguna ni se usa un timestamp del cliente

#### Scenario: Sin callback o sin autenticación
- **WHEN** el mensaje no tiene callback o el acceso ya no es válido
- **THEN** no se inserta una respuesta; la ausencia de callback descarta la operación y los fallos de autenticación conservan el contrato de `session-realtime`

#### Scenario: Varias opciones válidas
- **WHEN** distintos participantes eligen por separado dos índices incluidos en `correctIndexes`
- **THEN** ambos envíos conservan sus comprobantes individuales y se califican como aciertos al cerrar, sin exigir seleccionar varias opciones a la vez

### Requirement: Pertenencia y validación temporal autoritativas

El servicio SHALL resolver la sala a partir de la pregunta copiada y comprobar pertenencia antes de consultar/devolver respuestas o errores de su estado. Pregunta inexistente o sala ajena SHALL producir `SESSION_NOT_FOUND`; el host de esa sala SHALL recibir `HOST_CANNOT_PARTICIPATE`. Para respuestas nuevas SHALL registrar un instante de admisión con su reloj autoritativo al entrar al servicio después de autenticar y validar el comando, antes de cualquier consulta de BD o espera de coordinación; este instante SHALL ser `answeredAt` si se confirma la aceptación. No SHALL proceder del cliente, de una etiqueta de telemetría ni de un reloj monotónico convertido a fecha. Bajo exclusión transaccional SHALL exigir pertenencia, sala IN_PROGRESS, pregunta actual OPEN y `openedAt <= answeredAt < closesAt`, usando el instante registrado y no la hora posterior de procesamiento. La cola SHALL NOT extender el deadline ni habilitar reaperturas o inserciones retrospectivas en preguntas ya cerradas. Si la admisión alcanza `closesAt` de una pregunta abierta o previamente abierta SHALL devolver `ANSWER_TOO_LATE`; de otro modo una sala terminada SHALL devolver `SESSION_FINISHED`, y pregunta no actual/no abierta o sala en espera SHALL devolver `QUESTION_NOT_OPEN`. La finalización manual confirmada SHALL seguir siendo terminal para nuevas respuestas pendientes no confirmadas. La recuperación de un comprobante existente SHALL mantener la precedencia de idempotencia.

#### Scenario: Límite temporal exacto
- **WHEN** una respuesta nueva se admite exactamente en `closesAt`, aunque el worker todavía vea OPEN
- **THEN** recibe `ANSWER_TOO_LATE` sin registro, sin puntaje y sin ampliar la ventana

#### Scenario: Admisión anterior y procesamiento posterior al plazo
- **WHEN** una respuesta autenticada se admite antes de `closesAt`, espera por operaciones previas y se procesa después del plazo sin finalización manual ni otro cierre válido previo
- **THEN** se acepta con su timestamp autoritativo de admisión y el cierre automático no se adelanta a esa respuesta pendiente

#### Scenario: Otra sala o usuario no participante
- **WHEN** una cuenta intenta contestar una pregunta de una sala en la que no participa
- **THEN** recibe `SESSION_NOT_FOUND`, sin exponer el estado ni las respuestas de esa sala y sin que registrar una admisión le conceda pertenencia

#### Scenario: Pregunta cerrada anticipadamente
- **WHEN** se intenta responder por primera vez una pregunta cerrada antes de su deadline y la sala no está finalizada
- **THEN** recibe `QUESTION_NOT_OPEN` y no cambia el conteo ni la clasificación

#### Scenario: Pregunta anterior o futura
- **WHEN** un participante intenta crear una respuesta para una pregunta que no es la actual, sin respuesta suya previa
- **THEN** se rechaza con el error temporal si su instante de admisión está fuera del plazo o con `QUESTION_NOT_OPEN` de otro modo, sin revelar su solución

#### Scenario: Finalización manual mientras existe trabajo pendiente
- **WHEN** el host confirma la finalización antes de confirmar una respuesta pendiente que todavía no obtuvo su exclusión de sala
- **THEN** la respuesta no reabre ni modifica la sala finalizada, conservando precedencia de autorización, idempotencia y errores de dominio

### Requirement: Unicidad e idempotencia entre dispositivos

Cada par pregunta copiada/participante SHALL tener como máximo una respuesta persistida, incluso con doble clic, peticiones concurrentes o varios dispositivos de la cuenta. Después de autenticar y autorizar pertenencia, una respuesta existente con la misma elección relevante para su tipo SHALL devolver el comprobante original antes de evaluar fase/deadline. Esto SHALL funcionar en revisión, preguntas posteriores y partida finalizada. Una elección distinta SHALL devolver `ANSWER_ALREADY_SUBMITTED`. Ni repetición ni conflicto SHALL actualizar fecha, elección o puntos, repetir sumas, aumentar la secuencia pública ni publicar otra transición. La admisión de un reintento SHALL NOT reemplazar el timestamp del comprobante confirmado. No SHALL recuperar un comprobante de otra identidad.

#### Scenario: Dos envíos iguales concurrentes
- **WHEN** dos dispositivos del participante envían la misma elección para la misma pregunta
- **THEN** ambos recuperan el mismo id y answeredAt y existe exactamente un registro

#### Scenario: Dos elecciones distintas concurrentes
- **WHEN** compiten dos elecciones distintas para el mismo par, booleanas o de cuatro opciones
- **THEN** solo una queda persistida y la otra recibe `ANSWER_ALREADY_SUBMITTED`, sin reemplazar al ganador

#### Scenario: Ack perdido y reintento después del cierre
- **WHEN** se perdió el ack de una respuesta aceptada y el participante reenvía la misma elección después del cierre o fin de partida
- **THEN** recibe el comprobante original sin insertar, repuntuar ni publicar eventos adicionales

### Requirement: Aceptación y cierre atómicos

La aceptación, detección de todas las respuestas, cierre y puntuación SHALL compartir una transacción y exclusión de sala. Si la respuesta aceptada completa la participación esperada, SHALL cerrar/puntuar de inmediato conforme a `session-lifecycle`. No SHALL contarse al host, omisiones, duplicados ni respuestas de otra sala o fuera de la ventana de admisión. Los fallos SHALL revertir conjuntamente inserción, cierre, puntuación y resultados afectados; ninguna notificación SHALL presentar una operación revertida como confirmada. Una respuesta aceptada que no cierra la pregunta SHALL generar solo su comprobante privado, sin revelar el progreso de respuestas individuales a otros jugadores. El orden de admisiones previas y cierre automático SHALL impedir perder respuestas válidas por el tiempo de espera, sin introducir una tolerancia temporal para envíos nuevos posteriores al plazo.

#### Scenario: Última respuesta
- **WHEN** se procesa la última respuesta necesaria admitida antes de `closesAt`
- **THEN** se confirman una respuesta, un cierre y su puntuación juntos, y después se publica la fase resultante

#### Scenario: Respuesta y plazo concurrentes
- **WHEN** compiten una admisión anterior al plazo y el procesamiento automático de ese vencimiento
- **THEN** la admisión previa obtiene su resultado antes del cierre automático; un envío admitido desde el límite se rechaza, sin doble cierre ni puntuación duplicada

#### Scenario: Fallo durante el cierre
- **WHEN** falla la persistencia de un puntaje tras insertar la última respuesta
- **THEN** se revierte también esa inserción y el cierre y no se publica solución ni clasificación nueva

#### Scenario: Datos históricos
- **WHEN** se recuperan respuestas y resultados confirmados antes de este cambio
- **THEN** se conservan sus timestamps y puntajes originales, sin recalificarlos con la nueva semántica de admisión
