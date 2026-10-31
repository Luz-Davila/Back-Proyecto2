## MODIFIED Requirements

### Requirement: Acknowledgments y validación uniformes

Cada comando reconocido SHALL requerir un callback ack y responder exactamente una vez con `{ ok: true, data: <resultado> }` o `{ ok: false, error: { code: <codigo>, message: <descripcion> } }`. Un mensaje sin callback no SHALL ejecutar mutaciones ni crear suscripciones. SHALL rechazar tipos incorrectos, UUID inválidos, códigos mal formados y propiedades desconocidas mediante `VALIDATION_ERROR`, manteniendo códigos de dominio y usando `INTERNAL_ERROR` sin SQL, tokens ni stack para fallos inesperados. Mensajes no soportados con callback SHALL recibir `EVENT_NOT_SUPPORTED`. `answer:submit` SHALL ser un comando reconocido con payload, autorización, comprobante e idempotencia definidos en `game-answers`; su ack SHALL ser privado al socket solicitante. No SHALL emitirse además un evento de nombre `answer:ack`, ni respuestas individuales al resto de la sala.

#### Scenario: Fallo previo al handler
- **WHEN** falla la autenticación, validación o autorización de un comando con callback
- **THEN** se entrega un único ack de error con el mismo formato, sin un evento alternativo `exception` como respuesta al comando

#### Scenario: Mensaje sin callback
- **WHEN** se envía `game:start`, `room:join` o `answer:submit` sin callback ack
- **THEN** no cambia el dominio, no se inserta respuesta ni se incorpora el socket a una sala

#### Scenario: Paso cinco aún no disponible
El nombre histórico de este escenario identifica el contrato anterior; este cambio sustituye expresamente su resultado de evento no disponible por aceptación validada.
- **WHEN** un participante autenticado envía válidamente `answer:submit` con callback, antes rechazado por no estar implementado el paso cinco
- **THEN** recibe su AnswerReceipt privado y no un error `EVENT_NOT_SUPPORTED`, sin broadcast de su elección o puntaje

#### Scenario: Comprobante repetido
- **WHEN** se reenvía una respuesta ya aceptada con el mismo choice desde otro dispositivo autorizado de la cuenta
- **THEN** se recibe el mismo comprobante y no se duplica un ack por eventos alternativos ni una transición pública

### Requirement: Notificaciones aisladas posteriores al commit

Cada cambio efectivo confirmado de participantes o ciclo de vida SHALL publicar `room:state` únicamente a sockets autorizados y con acceso vigente de esa sala, incluido el emisor si está suscrito. Según su estado resultante SHALL publicar además `question:opened` cuando abre una pregunta, `question:closed` cuando entra en revisión o `game:finished` cuando finaliza. Cada cierre/puntuación nuevo SHALL publicar además `scoreboard:updated`, incluso si los totales no cambiaron porque todos obtuvieron cero. Todas esas notificaciones SHALL llevar el mismo RoomEnvelope del cambio definido en `safe-question-delivery`, con stream y secuencia compartidos. SHALL ordenarse como room:state, evento de pregunta si corresponde, scoreboard:updated si corresponde y game:finished al final si corresponde. Cambios de REST, plazos automáticos y mecanismos de recuperación existentes SHALL usar el mismo flujo. Un rollback, error, rejoin idempotente, repetición de respuesta, salida sin cambios o plazo obsoleto no SHALL emitir otra transición. Aceptar una respuesta sin cerrar no SHALL generar broadcast. La finalización anticipada SHALL publicar estado final y clasificación de la pregunta que cierre si existe, no una revisión artificial ni solución adicional.

#### Scenario: Dos salas activas
- **WHEN** se inicia, cambia, puntúa o finaliza una sala A y existen sockets suscritos solo a B
- **THEN** ningún socket exclusivo de B recibe room:state, question:opened, question:closed, scoreboard:updated ni game:finished de A

#### Scenario: Cambios de participantes por REST
- **WHEN** un jugador entra o sale por las rutas REST existentes
- **THEN** los suscriptores autorizados de esa sala reciben su listado actualizado sin necesitar un comando WebSocket

#### Scenario: Plazo sin host conectado
- **WHEN** vence la respuesta o revisión y el host está desconectado
- **THEN** los jugadores suscritos reciben la fase resultante y sus notificaciones correspondientes, incluida clasificación al cerrar, sin intervención del host

#### Scenario: Transacción revertida
- **WHEN** falla la persistencia de inicio, salida, última respuesta, puntuación o finalización y se revierte la transacción
- **THEN** no se emite ningún estado, solución ni clasificación que presente ese cambio como confirmado

#### Scenario: Commit seguido de fallo de entrega
- **WHEN** el cambio se confirma pero una entrega de notificación falla
- **THEN** no se revierte ni se repite la mutación; el estado y clasificación confirmados siguen disponibles por suscripción existente y el fallo se registra sin secretos

#### Scenario: Todos obtienen cero
- **WHEN** cierra una pregunta sin aciertos y se confirma su puntuación
- **THEN** se publica una sola actualización de clasificación de ese cierre aun si sus números son iguales a los anteriores

#### Scenario: Cierre de la última pregunta o finalización anticipada
- **WHEN** una operación puntúa una pregunta y deja la sala FINISHED
- **THEN** se publica la clasificación final antes de game:finished con el mismo stream/secuencia, sin question:closed de revisión ficticia
