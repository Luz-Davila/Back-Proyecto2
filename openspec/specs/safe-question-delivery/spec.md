# safe-question-delivery Specification

## Purpose

Entregar a los dispositivos el mismo estado de partida y pregunta con tiempos autoritativos, sin filtrar soluciones abiertas ni preguntas futuras, preservando las copias independientes del cuestionario original.

## Requirements

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

### Requirement: Pregunta abierta sin solución

Cuando una pregunta está abierta, `question:opened`, `room:state` y los acks con estado SHALL incluir la pregunta actual con exactamente `id`, `position`, `statement`, `imageUrl`, `status`, `openedAt`, `closesAt`, `closedAt` y `reviewEndsAt`, conforme a `session-rooms`. SHALL omitir por completo `correctBoolean`, no enviarlo como `null` ni ocultarlo solo en la interfaz. `imageUrl` SHALL ser una URL firmada temporal para la clave copiada, o `null` cuando no hay imagen. No SHALL existir una variante privilegiada que revele al host la solución antes de revisión.

#### Scenario: Apertura compartida entre dispositivos
- **WHEN** se abre una pregunta y hay dos dispositivos suscritos a la sala
- **THEN** ambos reciben el mismo identificador, posición, enunciado, referencia de imagen y `closesAt`, con el mismo stream y secuencia del cambio

#### Scenario: Host no ve solución abierta
- **WHEN** el host recibe un evento o ack durante una pregunta abierta
- **THEN** ninguna parte del payload contiene `correctBoolean`, preguntas futuras ni entidades de respuestas

#### Scenario: Imagen ausente
- **WHEN** la pregunta copiada no tiene imagen
- **THEN** `imageUrl` es `null` y la pregunta mantiene todos sus campos de tiempo sin inventar una imagen

### Requirement: Tiempo restante calculado por el servidor

El envelope SHALL expresar `remainingMs` como entero no negativo calculado con un único instante de servidor: `max(0, closesAt - serverTime)` en `ANSWERING`, y cero en las demás fases. Los instantes SHALL ser ISO 8601 UTC. El instante SHALL tomarse al preparar la entrega después de resolver la imagen firmada, sin extender el plazo por el tiempo de firma o latencia. En revisión el cliente SHALL disponer de `reviewEndsAt` para representar su plazo. No SHALL requerirse un broadcast por segundo ni usarse el reloj o contador del cliente para decidir cierres.

#### Scenario: Suscripción a mitad de pregunta
- **WHEN** un dispositivo se suscribe diez segundos después de abrir una pregunta de treinta segundos
- **THEN** recibe el mismo `closesAt` original y aproximadamente veinte segundos restantes según el instante real de preparación, no treinta segundos nuevos

#### Scenario: Plazo vencido antes de procesar cierre
- **WHEN** una lectura ve la pregunta aún OPEN pero el reloj ya alcanzó `closesAt`
- **THEN** el envelope informa `remainingMs = 0`, no amplía el plazo ni revela la solución antes de que el cierre esté confirmado

#### Scenario: Dispositivos con relojes distintos
- **WHEN** dos dispositivos reciben la misma apertura y tienen relojes locales desajustados
- **THEN** pueden dibujar su contador usando el tiempo del servidor y el deadline compartido, mientras el cierre continúa bajo autoridad del servidor

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

### Requirement: Entrega desde el snapshot existente

Toda pregunta entregada SHALL proceder de la copia persistida al crear la sala, ya anterior al inicio conforme a `session-rooms`. Iniciar, suscribirse, reconectar o avanzar no SHALL recapturar el cuestionario original. Cambios o eliminación posteriores del quiz no SHALL alterar título copiado, orden, enunciados, respuestas correctas ni claves de imagen de la partida. Esta independencia de metadatos no SHALL presentarse como retención física del binario de imagen si el objeto se elimina de Storage.

#### Scenario: Edición durante la espera
- **WHEN** se cambian título, orden, enunciados, soluciones o referencias de imágenes del quiz después de crear la sala y antes de iniciarla
- **THEN** los dispositivos reciben las copias originales de esa sala, no una captura actualizada al iniciar

#### Scenario: Edición o eliminación durante el juego
- **WHEN** se edita o elimina el quiz original durante una partida y un dispositivo reconecta
- **THEN** se conserva la misma pregunta copiada, orden y deadline, sin consultar el original para reconstruir el juego

#### Scenario: Copia de imagen sin duplicación del binario
- **WHEN** la referencia de imagen del quiz original cambia y el objeto copiado sigue disponible en Storage
- **THEN** la sala firma la clave que capturó al crearse, sin reemplazarla por la imagen nueva ni duplicar físicamente archivos
