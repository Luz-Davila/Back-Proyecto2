## Purpose

Permitir dirigir y observar partidas en tiempo real mediante conexiones autenticadas, con aislamiento entre salas, renovación de acceso y recuperación del estado sin duplicar la participación de una cuenta.

## ADDED Requirements

### Requirement: Autenticación de conexión y comandos

El servicio de tiempo real SHALL aceptar conexiones en namespace `/sessions`, path `/socket.io`, con un JWT de acceso en `handshake.auth.token`, sin prefijo Bearer. SHALL verificar firma, emisor, audiencia, algoritmo permitido, identidad y expiración numérica del token antes de aceptar la conexión. SHALL autenticar cada comando usando el token vigente del socket y obtener de él la identidad; los roles del token no SHALL sustituir la autorización de host o participante de la sala. No SHALL aceptar credenciales desde query strings ni identidades o roles declarados en payloads de juego.

#### Scenario: Handshake inválido
- **WHEN** falta el token o es inválido, expirado o carece de expiración válida
- **THEN** la conexión es rechazada mediante `connect_error` con `data = { code: "UNAUTHORIZED", message: <descripcion> }`, sin suscripción ni cambios de BD

#### Scenario: Comando autenticado por identidad real
- **WHEN** una cuenta envía un comando con campos adicionales `userId`, `actorId`, `hostId` o `role`
- **THEN** recibe ack `VALIDATION_ERROR`, no se ejecuta el comando y no se acepta suplantación de identidad

#### Scenario: Token vence sin nuevos comandos
- **WHEN** llega el vencimiento del JWT de un socket conectado, aunque no envíe mensajes
- **THEN** el servidor lo desconecta y deja de entregarle broadcasts, sin retirar su participación ni detener la partida

### Requirement: Renovación de acceso sin cambiar de cuenta

El servicio SHALL aceptar `auth:refresh` con exactamente `{ token: <nuevoJwt> }` antes de vencer el acceso actual. SHALL validar el nuevo JWT con los mismos controles del handshake y exigir la misma identidad. Una renovación válida SHALL sustituir el acceso y su vencimiento sin desconectar ni perder suscripciones. Una renovación rechazada SHALL mantener el acceso anterior solo hasta su vencimiento original. El servicio no SHALL recibir refresh tokens de Supabase, emitir JWT ni ampliar su vigencia; la renovación del JWT corresponde al cliente y Supabase Auth.

#### Scenario: Renovación durante una pregunta
- **WHEN** el cliente presenta a tiempo un JWT válido de la misma cuenta con vencimiento posterior
- **THEN** recibe `{ ok: true, data: { userId: <uuid>, expiresAt: <fechaUTC> } }` y sigue recibiendo la misma sala sin reconectar

#### Scenario: Renovación inválida o de otra cuenta
- **WHEN** el nuevo token es inválido o pertenece a otra identidad
- **THEN** recibe ack `UNAUTHORIZED`, no se reemplaza la identidad y el vencimiento anterior sigue vigente

#### Scenario: Renovación posterior al vencimiento
- **WHEN** el acceso del socket ya venció
- **THEN** no puede reactivarse mediante `auth:refresh`; el cliente obtiene un nuevo JWT y establece una conexión nueva

#### Scenario: Temporizador anterior a una renovación
- **WHEN** se ejecuta un temporizador asociado al token que ya fue reemplazado válidamente
- **THEN** no desconecta el socket autenticado con el nuevo token

### Requirement: Incorporación y suscripción autorizadas por sala

El servicio SHALL aceptar `room:join` con exactamente `{ code: <codigo> }`, con la normalización y reglas de incorporación de `session-rooms`, y suscribir únicamente al socket solicitante a la sala resultante tras autorizarlo. SHALL aceptar `room:subscribe` con exactamente `{ sessionId: <uuid> }` para el host o un participante registrado, también en partidas finalizadas, sin crear participantes. El nombre interno de la room no SHALL ser un mecanismo de autorización. No SHALL suscribir automáticamente a todas las salas de una cuenta. La lectura inicial y la activación de la suscripción SHALL impedir perder una transición concurrente o conservar acceso después de una salida ya confirmada.

#### Scenario: Join válido y repetido
- **WHEN** el mismo jugador realiza `room:join` desde dos dispositivos en espera o repite su incorporación existente durante la partida
- **THEN** ambos sockets reciben `{ ok: true, data: { participant: <participante>, room: <RoomEnvelope> } }`, comparten el mismo participante y fecha de incorporación, y quedan suscritos sin duplicados

#### Scenario: Host se conecta a su sala
- **WHEN** el host envía `room:subscribe` con el identificador de su sala
- **THEN** recibe `{ ok: true, data: <RoomEnvelope> }` y queda suscrito sin figurar como jugador

#### Scenario: Suscripción ajena o inexistente
- **WHEN** un usuario ajeno solicita suscribirse a una sala o proporciona un UUID sin sala asociada
- **THEN** recibe ack `SESSION_NOT_FOUND` sin estado y no recibe ningún broadcast de esa sala

#### Scenario: Restricciones de incorporación existentes
- **WHEN** se intenta un primer join después del inicio, un join a sala finalizada, participar como host propio o incorporarse a otra sala activa
- **THEN** se mantienen respectivamente `SESSION_NOT_JOINABLE`, `SESSION_FINISHED`, `HOST_CANNOT_PARTICIPATE` o `ALREADY_IN_ACTIVE_SESSION`, sin suscripciones no autorizadas

#### Scenario: Suscripción concurrente con un cambio
- **WHEN** un usuario autorizado se suscribe mientras cambia la pregunta o la lista de participantes
- **THEN** obtiene el cambio en su estado inicial o en una notificación posterior, sin regresar después a un estado anterior

### Requirement: Salida explícita y múltiples dispositivos

El servicio SHALL aceptar `room:leave` con exactamente `{ sessionId: <uuid> }` y aplicar la salida idempotente en espera definida por `session-rooms`. Tras confirmar una salida, por WebSocket o REST, SHALL retirar de esa sala todos los sockets de esa identidad antes de publicar el nuevo estado. No SHALL retirarlos de otras salas que puedan consultar legítimamente. Desconectar un dispositivo no SHALL eliminar participación, liberar la reserva, modificar el listado ni desconectar otros dispositivos. La suscripción de otro dispositivo SHALL requerir un `room:join` o `room:subscribe` autorizado.

#### Scenario: Salida de un dispositivo
- **WHEN** un jugador con dos sockets suscritos abandona explícitamente una sala en espera
- **THEN** recibe `{ ok: true, data: { sessionId: <uuid> } }`, se libera su participación y ninguno de sus sockets recibe nuevos estados de esa sala hasta volver a entrar válidamente

#### Scenario: Salida repetida y fuera de espera
- **WHEN** se repite una salida en espera o se solicita salir en `IN_PROGRESS` o `FINISHED`
- **THEN** la repetición en espera es exitosa sin nuevo cambio; fuera de espera devuelve `SESSION_NOT_LEAVABLE` y conserva participación y suscripciones autorizadas

#### Scenario: Cerrar una pestaña
- **WHEN** se desconecta uno de los dispositivos de un jugador
- **THEN** su otro dispositivo sigue conectado, no se publica una baja de participante y su reserva de sala permanece

#### Scenario: Salida REST compite con suscripción
- **WHEN** una salida REST y una suscripción del mismo jugador se procesan concurrentemente
- **THEN** tras confirmarse la salida ningún socket del jugador conserva acceso a broadcasts de esa sala

### Requirement: Comandos del host con permisos del dominio

El servicio SHALL aceptar `game:start` y `game:finish` con exactamente `{ sessionId: <uuid> }`, y `game:advance` con exactamente `{ sessionId: <uuid>, expectedQuestionId: <uuid> }`. SHALL ejecutar las reglas de `session-lifecycle` con el actor autenticado, sin confiar en la pertenencia a una room ni en roles autodeclarados. No SHALL exigir una suscripción previa para ejecutar un comando autorizado ni suscribir implícitamente al emisor de estos comandos. En éxito SHALL devolver `{ ok: true, data: <RoomEnvelope> }` de su cambio confirmado; en error no SHALL publicar una transición exitosa.

#### Scenario: Inicio ajeno
- **WHEN** un participante o el host de otra sala envía `game:start` para una sala existente que no dirige
- **THEN** recibe `HOST_REQUIRED`, la sala permanece sin cambios y no se publica `question:opened`

#### Scenario: Inicio simultáneo desde dos dispositivos del host
- **WHEN** llegan dos inicios concurrentes para una sala válida
- **THEN** solo uno tiene éxito, el otro devuelve `SESSION_ALREADY_STARTED` y solo ocurre una apertura inicial

#### Scenario: Avance restringido
- **WHEN** el host intenta avanzar una pregunta abierta, acortar la revisión o avanzar usando una pregunta obsoleta
- **THEN** recibe `QUESTION_NOT_CLOSED`, `REVIEW_IN_PROGRESS` o `STALE_QUESTION`, conforme al dominio, sin saltar preguntas

#### Scenario: Finalización autorizada
- **WHEN** el host finaliza en espera, respuesta o revisión
- **THEN** se conserva la finalización anticipada del dominio y los suscriptores de esa sala reciben el estado y los resultados finales, sin abrir preguntas pendientes

### Requirement: Acknowledgments y validación uniformes

Cada comando reconocido SHALL requerir un callback ack y responder exactamente una vez con `{ ok: true, data: <resultado> }` o `{ ok: false, error: { code: <codigo>, message: <descripcion> } }`. Un mensaje sin callback no SHALL ejecutar mutaciones ni crear suscripciones. SHALL rechazar tipos incorrectos, UUID inválidos, códigos mal formados y propiedades desconocidas mediante `VALIDATION_ERROR`, manteniendo códigos de dominio y usando `INTERNAL_ERROR` sin SQL, tokens ni stack para fallos inesperados. Mensajes no soportados con callback SHALL recibir `EVENT_NOT_SUPPORTED`. `answer:submit` no SHALL aceptar ni almacenar respuestas en este incremento, y no SHALL emitirse `answer:ack`.

#### Scenario: Fallo previo al handler
- **WHEN** falla la autenticación, validación o autorización de un comando con callback
- **THEN** se entrega un único ack de error con el mismo formato, sin un evento alternativo `exception` como respuesta al comando

#### Scenario: Mensaje sin callback
- **WHEN** se envía `game:start` o `room:join` sin callback ack
- **THEN** no cambia el dominio ni se incorpora el socket a una sala

#### Scenario: Paso cinco aún no disponible
- **WHEN** un cliente envía `answer:submit` con callback
- **THEN** recibe `EVENT_NOT_SUPPORTED`, no se inserta ninguna Answer y no se emite `answer:ack`

### Requirement: Notificaciones aisladas posteriores al commit

Cada cambio efectivo confirmado de participantes o ciclo de vida SHALL publicar `room:state` únicamente a sockets autorizados y con acceso vigente de esa sala, incluido el emisor si está suscrito. Según su estado resultante SHALL publicar además `question:opened` cuando abre una pregunta, `question:closed` cuando entra en revisión o `game:finished` cuando finaliza. Cada notificación SHALL llevar el `RoomEnvelope` definido en `safe-question-delivery`. Las transiciones originadas por REST, plazos automáticos y recuperación SHALL usar el mismo mecanismo. Un rollback, error, rejoin idempotente, salida sin cambios o plazo obsoleto no SHALL emitir una transición nueva. La finalización anticipada SHALL publicar finalización, no una revisión artificial ni una solución adicional.

#### Scenario: Dos salas activas
- **WHEN** se inicia, cambia o finaliza una sala A y existen sockets suscritos solo a B
- **THEN** ningún socket exclusivo de B recibe `room:state`, `question:opened`, `question:closed` ni `game:finished` de A

#### Scenario: Cambios de participantes por REST
- **WHEN** un jugador entra o sale por las rutas REST existentes
- **THEN** los suscriptores autorizados de esa sala reciben su listado actualizado sin necesitar un comando WebSocket

#### Scenario: Plazo sin host conectado
- **WHEN** vence la respuesta o revisión y el host está desconectado
- **THEN** los jugadores suscritos reciben la fase resultante y su notificación correspondiente sin intervención del host

#### Scenario: Transacción revertida
- **WHEN** falla la persistencia de un inicio, salida o finalización y se revierte la transacción
- **THEN** no se emite ningún estado ni evento que presente ese cambio como confirmado

#### Scenario: Commit seguido de fallo de entrega
- **WHEN** el cambio se confirma pero una entrega de notificación falla
- **THEN** no se revierte ni se repite la mutación; el estado confirmado sigue recuperable y el fallo se registra sin secretos

### Requirement: Orden de estados y recuperación sin replay

El servicio SHALL identificar cada estado de sala con un `streamId` opaco y una `sequence` entera no negativa, creciente por cambio efectivo dentro del mismo stream. El estado inicial de una suscripción y las notificaciones SHALL ser ordenables; una consulta sin cambio no SHALL aumentar la secuencia. Los eventos del mismo cambio SHALL compartir identificadores. Reconectar SHALL exigir JWT válido y nueva suscripción explícita, y devolver el estado actual, no reproducir eventos perdidos. Un reinicio o recreación del stream SHALL cambiar `streamId`; no SHALL prometer continuidad de secuencia entre streams ni entrega durable exactamente una vez. El despliegue inicial SHALL operar con una instancia que atiende múltiples salas.

#### Scenario: Proyección lenta de una notificación
- **WHEN** la generación de una imagen firmada de un cambio tarda mientras llega otro cambio de la misma sala
- **THEN** los estados se entregan en orden y el cliente no debe aplicar una secuencia inferior a la ya observada dentro del mismo stream

#### Scenario: Reconexión durante la partida
- **WHEN** un dispositivo vuelve a conectarse y se suscribe válidamente tras perder una apertura o cierre
- **THEN** recibe el estado actual y tiempos vigentes, sin otra participación ni reenvío de una pregunta histórica

#### Scenario: Reinicio de la instancia
- **WHEN** el servidor reinicia y recupera los plazos persistidos
- **THEN** el cliente reconectado recibe un stream nuevo con el estado recuperado, sin reiniciar la partida ni depender del host

### Requirement: Orígenes permitidos y cierre de recursos

El servicio SHALL aplicar la lista configurada de orígenes permitidos al establecimiento del transporte en navegador, tanto polling como WebSocket, sin usarla como sustituto del JWT. Un cliente sin cabecera Origin SHALL seguir requiriendo JWT válido. Al detener la instancia SHALL cerrar conexiones y liberar temporizadores de autenticación y recursos de suscripción, sin eliminar salas ni participación persistida.

#### Scenario: Origen no permitido
- **WHEN** un navegador intenta conectarse desde un Origin no autorizado
- **THEN** no logra establecer una conexión de juego aunque suministre un JWT válido

#### Scenario: Apagado controlado
- **WHEN** se detiene el módulo con sockets y renovaciones programadas
- **THEN** las conexiones cierran, no quedan temporizadores activos de sockets y los datos de la partida siguen persistidos
