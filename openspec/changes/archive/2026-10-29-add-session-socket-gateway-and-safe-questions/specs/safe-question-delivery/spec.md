## Purpose

Entregar a los dispositivos el mismo estado de partida y pregunta con tiempos autoritativos, sin filtrar soluciones abiertas ni preguntas futuras, preservando las copias independientes del cuestionario original.

## ADDED Requirements

### Requirement: Envelope de estado seguro en tiempo real

El servicio SHALL usar `RoomEnvelope` con exactamente `sessionId`, `streamId`, `sequence`, `serverTime`, `remainingMs` y `state`. `state` SHALL mantener el contrato `SessionState` de `session-rooms`, sin agregar ni eliminar campos del REST. `sessionId` SHALL coincidir con `state.id` y `serverTime` con `state.serverTime`. El envelope SHALL ser el payload de `room:state`, `question:opened`, `question:closed` y `game:finished`, y el resultado de suscripción y comandos de control exitosos. La misma proyección segura SHALL aplicar al host y a participantes; no SHALL serializar entidades completas, respuestas individuales, claves internas de imagen, credenciales ni preguntas futuras.

#### Scenario: Estado inicial en espera
- **WHEN** el host o jugador se suscribe a una sala en espera
- **THEN** recibe el envelope con `state.phase = WAITING`, `currentQuestion = null`, `results = null` y `remainingMs = 0`

#### Scenario: Contrato REST conservado
- **WHEN** se consulta el mismo estado por REST
- **THEN** se mantienen los campos de `SessionState` previamente definidos, sin añadirle stream, secuencia ni tiempo restante

#### Scenario: Datos de otra sala
- **WHEN** se produce cualquier envelope para una sala
- **THEN** su estado, pregunta, participantes y resultados pertenecen exclusivamente a su `sessionId`

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

`question:closed` SHALL publicarse únicamente para un estado confirmado en fase `REVIEW`, con la pregunta actual CLOSED, `correctBoolean`, `closedAt` y `reviewEndsAt`. SHALL respetar la revisión de cinco segundos del dominio. Una fase `FINISHED` SHALL tener `currentQuestion = null`, `remainingMs = 0` y resultados finales según `session-rooms`, sin revelar preguntas nunca abiertas. Una recuperación que ya pasó la revisión SHALL publicar la fase actual sin reproducir soluciones de revisiones omitidas.

#### Scenario: Cierre normal
- **WHEN** se confirma el cierre por vencimiento y comienza la revisión
- **THEN** se entrega `room:state` y `question:closed` del mismo cambio con la solución de esa pregunta y cinco segundos entre cierre efectivo y fin de revisión

#### Scenario: Siguiente apertura
- **WHEN** termina la revisión y abre la siguiente pregunta
- **THEN** la nueva entrega omite `correctBoolean`, contiene solo la nueva pregunta actual y conserva la duración completa fijada por el dominio

#### Scenario: Finalización anticipada
- **WHEN** el host termina durante una pregunta abierta
- **THEN** se entrega `game:finished` con estado final y resultados, sin un evento de revisión artificial ni soluciones de preguntas pendientes

#### Scenario: Recuperación atrasada
- **WHEN** el servidor recupera un plazo cuya revisión ya terminó
- **THEN** publica la siguiente pregunta o la finalización resultante, sin emitir `question:closed` para una revisión histórica ya superada

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
