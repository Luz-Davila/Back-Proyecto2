# game-answers Specification

## Purpose

Aceptar respuestas auténticas una sola vez, puntuar preguntas cerradas con un bono de rapidez verificable y mostrar clasificación acumulada sin revelar aciertos de preguntas abiertas.

## Requirements

### Requirement: Envío autenticado y comprobante privado

El servicio SHALL aceptar `answer:submit` únicamente por Socket.IO con exactamente `{ sessionQuestionId: <uuid>, choice: <boolean> }` y callback ack. SHALL obtener usuario y participante desde el JWT y pertenencia persistida, sin aceptar `sessionId`, `userId`, `participantId`, `answeredAt`, `score`, rol ni campos adicionales en el payload. SHALL exigir acceso vigente en cada envío y aplicar `VALIDATION_ERROR` a cuerpos inválidos o coerciones de booleanos. En éxito SHALL devolver `{ ok: true, data: { answer: <AnswerReceipt> } }`; `AnswerReceipt` SHALL contener exactamente `id`, `sessionQuestionId`, `choice` y `answeredAt` en UTC. No SHALL incluir puntaje, solución, otros jugadores ni un estado de sala dentro de este comprobante. `answer:ack` SHALL designar este callback, no un evento separado ni broadcast. No SHALL agregarse un endpoint HTTP de respuestas.

#### Scenario: Respuesta válida
- **WHEN** un participante envía un booleano para la pregunta actual abierta antes del vencimiento
- **THEN** recibe el comprobante de una respuesta persistida con identidad y fecha asignadas por el servidor

#### Scenario: Suplantación o datos calculados por cliente
- **WHEN** el cuerpo incluye otra identidad, un puntaje o timestamp, o choice vale `"true"`, 1, null o falta
- **THEN** recibe `VALIDATION_ERROR` y no se crea ni modifica respuesta alguna

#### Scenario: Sin callback o sin autenticación
- **WHEN** el mensaje no tiene callback o el acceso ya no es válido
- **THEN** no se inserta una respuesta; la ausencia de callback descarta la operación y los fallos de autenticación conservan el contrato de `session-realtime`

### Requirement: Pertenencia y validación temporal autoritativas

El servicio SHALL resolver la sala a partir de la pregunta copiada y comprobar pertenencia antes de consultar/devolver respuestas o errores de su estado. Pregunta inexistente o sala ajena SHALL producir `SESSION_NOT_FOUND`; el host de esa sala SHALL recibir `HOST_CANNOT_PARTICIPATE`. Para una respuesta nueva SHALL exigir sala IN_PROGRESS, pregunta actual OPEN y `openedAt <= answeredAt < closesAt`. `answeredAt` SHALL ser el instante de validación del servidor bajo exclusión de sala, sin usar hora de llegada reportada por el cliente ni ampliar el deadline por cola, latencia o demora del worker. Si una pregunta abierta o previamente abierta ya alcanzó `closesAt`, SHALL devolver `ANSWER_TOO_LATE`; de otro modo una sala terminada SHALL devolver `SESSION_FINISHED`, y pregunta no actual/no abierta o sala aún en espera SHALL devolver `QUESTION_NOT_OPEN`. La recuperación de un comprobante ya existente SHALL seguir la precedencia de idempotencia, no estas restricciones para nuevas respuestas.

#### Scenario: Límite temporal exacto
- **WHEN** una respuesta nueva se valida exactamente en `closesAt`, aunque el worker todavía vea OPEN
- **THEN** recibe `ANSWER_TOO_LATE` sin registro, sin puntaje y sin ampliar la ventana

#### Scenario: Otra sala o usuario no participante
- **WHEN** una cuenta intenta contestar una pregunta de una sala en la que no participa
- **THEN** recibe `SESSION_NOT_FOUND`, sin exponer el estado ni las respuestas de esa sala

#### Scenario: Pregunta cerrada anticipadamente
- **WHEN** se intenta responder por primera vez una pregunta cerrada antes de su deadline y la sala no está finalizada
- **THEN** recibe `QUESTION_NOT_OPEN` y no cambia el conteo ni la clasificación

#### Scenario: Pregunta anterior o futura
- **WHEN** un participante intenta crear una respuesta para una pregunta que no es la actual, sin respuesta suya previa
- **THEN** se rechaza con el error temporal si venció su deadline o con `QUESTION_NOT_OPEN` de otro modo, sin revelar su solución

### Requirement: Unicidad e idempotencia entre dispositivos

Cada par pregunta copiada/participante SHALL tener como máximo una respuesta persistida, incluso con doble clic, peticiones concurrentes o varios dispositivos de la cuenta. Después de autenticar y autorizar pertenencia, una respuesta existente con el mismo choice SHALL devolver el comprobante original antes de evaluar fase/deadline. Esto SHALL funcionar en revisión, preguntas posteriores y partida finalizada. Un choice distinto para ese par SHALL devolver `ANSWER_ALREADY_SUBMITTED`. Ni repetición ni conflicto SHALL actualizar fecha, elección o puntos, repetir sumas, aumentar la secuencia pública ni publicar otra transición. No SHALL recuperar un comprobante de otra identidad.

#### Scenario: Dos envíos iguales concurrentes
- **WHEN** dos dispositivos del participante envían la misma elección para la misma pregunta
- **THEN** ambos recuperan el mismo id y answeredAt y existe exactamente un registro

#### Scenario: Dos elecciones distintas concurrentes
- **WHEN** compiten true y false para el mismo par
- **THEN** solo una elección queda persistida y la otra recibe `ANSWER_ALREADY_SUBMITTED`, sin reemplazar al ganador

#### Scenario: Ack perdido y reintento después del cierre
- **WHEN** se perdió el ack de una respuesta aceptada y el participante reenvía el mismo choice después del cierre o fin de partida
- **THEN** recibe el comprobante original sin insertar, repuntuar ni publicar eventos adicionales

### Requirement: Aceptación y cierre atómicos

La aceptación, detección de todas las respuestas, cierre y puntuación SHALL compartir una transacción y exclusión de sala. Si la respuesta aceptada completa la participación esperada, SHALL cerrar/puntuar de inmediato conforme a `session-lifecycle`. No SHALL contarse al host, omisiones, duplicados ni respuestas de otra sala. Los fallos SHALL revertir conjuntamente inserción, cierre, puntuación y resultados afectados; ninguna notificación SHALL presentar una operación revertida como confirmada. Una respuesta aceptada que no cierra la pregunta SHALL generar solo su comprobante privado, sin revelar el progreso de respuestas individuales a otros jugadores.

#### Scenario: Última respuesta
- **WHEN** se acepta la última respuesta necesaria antes de `closesAt`
- **THEN** se confirman una respuesta, un cierre y su puntuación juntos, y después se publica la fase resultante

#### Scenario: Respuesta y plazo concurrentes
- **WHEN** compiten un envío y el procesamiento del vencimiento
- **THEN** se respeta el reloj bajo exclusión: o se acepta antes del límite y se cuenta una vez, o se rechaza sin registro; no hay doble cierre ni puntuación duplicada

#### Scenario: Fallo durante el cierre
- **WHEN** falla la persistencia de un puntaje tras insertar la última respuesta
- **THEN** se revierte también esa inserción y el cierre y no se publica solución ni clasificación nueva

### Requirement: Puntuación determinista y bono de rapidez

Al cerrar una pregunta, el sistema SHALL puntuar solo respuestas aceptadas de sus jugadores usando la solución del snapshot: choice incorrecto = 0; acierto = 1. Entre los aciertos con `0 <= answeredAt - openedAt < 3000 ms`, SHALL otorgar dos puntos adicionales a los que compartan el menor answeredAt de ese conjunto: total 3. Si nadie acierta en esa ventana no SHALL existir bono. Una respuesta incorrecta temprana no SHALL consumir el bono; no SHALL existir desempate por id ni orden de ejecución cuando los timestamps empatan. La puntuación SHALL quedar confirmada junto con el cierre, ser recuperable sin recalcular sumas incrementales y no cambiar por reintentos de comandos, plazos o consultas. Las omisiones SHALL aportar cero sin fabricar respuestas.

#### Scenario: Primer acierto rápido
- **WHEN** hay un error a los 400 ms, un acierto a los 800 ms y otro a los 1500 ms
- **THEN** reciben respectivamente 0, 3 y 1 puntos

#### Scenario: Frontera del bono
- **WHEN** el primer acierto se acepta a los 3000 ms exactos o más tarde
- **THEN** recibe 1 punto y no se concede bono a esa pregunta

#### Scenario: Empate exacto en el primer acierto
- **WHEN** dos aciertos comparten el menor answeredAt dentro de los primeros 3000 ms
- **THEN** ambos reciben 3 y los aciertos posteriores reciben 1

#### Scenario: Reintento de puntuación
- **WHEN** un cierre o cálculo se solicita de nuevo para una pregunta ya puntuada
- **THEN** los puntos almacenados y acumulados permanecen iguales, sin añadir otro bono ni sumarlos otra vez

### Requirement: Clasificación parcial de preguntas cerradas

La tabla SHALL contener exactamente filas `{ participantId, totalScore, rank }` para todos los jugadores registrados, incluido cero y excluido host, ordenadas por totalScore descendente y participantId ascendente como orden estable. Los puestos SHALL ser densos: 3,3,1 produce 1,1,2. Durante WAITING y antes de cerrar la primera pregunta los totales SHALL ser cero. Durante ANSWERING SHALL sumar únicamente preguntas ya cerradas/puntuadas, sin revelar score, choice, aceptación o tiempo individual de la pregunta abierta. La tabla SHALL actualizarse después de cada cierre y quedar disponible en los envelopes existentes, incluida la suscripción actual; al finalizar SHALL coincidir con los resultados definitivos persistidos. Consultar/repetir notificaciones no SHALL incrementar acumulados ni crear resultados parciales duplicados. Resultados históricos previos al cambio SHALL conservarse sin recalificación.

#### Scenario: Acierto aún abierto
- **WHEN** se acepta un acierto de la pregunta actual pero aún quedan participantes y tiempo
- **THEN** solo su autor recibe comprobante y la clasificación pública sigue mostrando los totales del cierre anterior

#### Scenario: Cierre con omisiones
- **WHEN** cierra una pregunta con un ganador rápido, otro acierto y un jugador ausente
- **THEN** la tabla incorpora 3, 1 y 0 a sus totales respectivos sin crear una respuesta del ausente

#### Scenario: Tabla al volver a suscribirse
- **WHEN** un participante registrado solicita el estado por el mecanismo WebSocket existente después de un cierre
- **THEN** recibe la tabla acumulada confirmada sin añadir registros de participación ni requerir el nuevo endpoint del paso 7

#### Scenario: Historial finalizado
- **WHEN** se consulta por WebSocket una partida finalizada antes de aplicar este cambio
- **THEN** la tabla refleja sus resultados persistidos originales y no reemplaza sus puntajes por la fórmula nueva
