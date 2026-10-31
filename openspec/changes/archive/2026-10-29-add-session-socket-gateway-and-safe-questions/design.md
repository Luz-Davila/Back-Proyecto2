## Context

Ver `proposal.md`, sección Why, y los contratos de `session-realtime` y `safe-question-delivery` de este cambio.

El backend usa NestJS 11, TypeORM/PostgreSQL, `jose` y Supabase Auth/Storage. No existen dependencias de Socket.IO ni Gateway. `SessionRoomsService` ya crea snapshots en una transacción REPEATABLE READ y autoriza consultas; `SessionLifecycleService` muta bajo el bloqueo de sala y devuelve `Promise<void>`. `SessionDeadlinesService` usa esos comandos al arrancar y cada 250 ms. `SessionStateProjector` omite soluciones abiertas, firma imágenes y solo expone la pregunta actual.

El guard global actual supone contexto HTTP; no puede aplicarse sin adaptación a eventos. Los filtros de errores de sesiones actuales son HTTP y no proveen acks WebSocket. El usuario acordó una sola instancia del backend en un VPS de Hostinger, múltiples dispositivos por cuenta, renovación de acceso sin desconectar y no implementar respuestas todavía.

## Goals / Non-Goals

**Goals:**
- Mantener decisiones de permisos, estados y tiempos en el dominio; el Gateway solo valida el transporte, autentica y despacha comandos.
- Publicar únicamente cambios confirmados y snapshots seguros, también desde REST y plazos, sin carreras de suscripción/salida ni inversión de estados por la firma de imágenes.
- Conservar contratos REST y datos existentes; hacer verificables los límites de seguridad con sockets reales y BD exclusiva de pruebas.

**Non-Goals:**
- Aceptar respuestas, definir puntuación, presencia online, espectadores, nuevos límites de salas dirigidas, pausa o transferencia del host.
- Cambiar TTL de JWT en Supabase, custodiar refresh tokens, implementar frontend o desplegar el VPS.
- Redis/cluster, replay persistente, outbox durable, garantías exactly-once, migraciones o copiar físicamente imágenes.

## Decisions

### 1. Transporte separado y contrato explícito

Agregar un Gateway en `src/sessions/` con namespace `/sessions`, path `/socket.io` y el mismo servidor HTTP/puerto de Nest. Usar Socket.IO 4 y paquetes WebSocket de Nest compatibles con su versión 11; `socket.io-client` se agrega para integración. Mantener los módulos/providers de juego fuera del Gateway y evitar dependencias circulares: el dominio publica a un puerto de notificación que implementa el adaptador de tiempo real, sin importar sockets en reglas o repositorios.

La siguiente tabla fija nombres y forma de resultados; UUID y código se validan igual que REST. Todos los cuerpos rechazan campos adicionales. No se envía otro JWT en cada payload de juego: se autentica el token guardado por el socket.

| Comando cliente → servidor | Payload exacto | `data` del ack exitoso |
|---|---|---|
| `auth:refresh` | `{ token }` | `{ userId, expiresAt }` |
| `room:join` | `{ code }` | `{ participant, room: RoomEnvelope }` |
| `room:subscribe` | `{ sessionId }` | `RoomEnvelope` |
| `room:leave` | `{ sessionId }` | `{ sessionId }` |
| `game:start` | `{ sessionId }` | `RoomEnvelope` |
| `game:advance` | `{ sessionId, expectedQuestionId }` | `RoomEnvelope` |
| `game:finish` | `{ sessionId }` | `RoomEnvelope` |

Ack único: `{ ok: true, data }` o `{ ok: false, error: { code, message } }`, sin `statusCode`. El handshake falla con `connect_error.data = { code, message }`. Los cuatro eventos servidor → cliente son `room:state`, `question:opened`, `question:closed`, `game:finished`, todos con `RoomEnvelope`. No hay evento adicional `game:started`: `game:start` es el comando y `question:opened` confirma la apertura a suscriptores.

La capa de despacho comprueba callback antes de actuar y evita doble ack entre validación, guard y handler. El filtro/normalizador se vincula explícitamente al Gateway; no se depende del filtro HTTP global. Un fallback para nombres desconocidos responde `EVENT_NOT_SUPPORTED` si existe callback, sin interceptar dos veces eventos reconocidos ni crear un handler público de respuestas. Sin callback, descartar sin efectos ni respuesta de dominio. Se preservan códigos de `SessionError`; errores internos se registran sin secretos.

**Alternativas descartadas:** usar eventos genéricos `exception` junto con ack hace ambiguo el resultado; tratar emisión sin callback como comando válido impide cumplir el contrato acordado.

### 2. Autenticación, expiración y renovación por socket

Reutilizar la verificación criptográfica de `AuthService`. Extraer internamente una ruta que entregue `{ user, expiresAt }` desde claims ya verificados; conservar `verifyAccessToken(): Promise<AuthenticatedUser>` para REST. Nunca confiar en un `decode` sin firma ni devolver tokens/claims completos en perfiles. Para sockets exigir `exp` numérico finito y futuro, además de los controles existentes de issuer, audience, algoritmo y UUID de `sub`.

El middleware de namespace autentica antes de aceptar, guarda token, identidad, vencimiento y generación de autenticación en datos privados del socket. El guard global de HTTP debe distinguir transportes sin desproteger rutas REST; el Gateway tendrá guard/dispatcher explícito para verificar acceso en cada comando. No marcar el Gateway público como atajo.

Programar vencimiento para desconectar sockets inactivos, cancelar/reemplazar el timer al renovar y comprobar la generación para que un timer anterior no desconecte un acceso nuevo. Antes de cada envío, además del timer, excluir sockets cuyo acceso ya venció; esto cubre retrasos del event loop. El token debe ser válido al admitir un comando; la expiración posterior no revierte una transacción ya admitida, pero sí impide entregas a ese socket vencido.

Serializar eventos de autenticación de cada socket y volver a comprobar su generación antes de instalar un token renovado. `auth:refresh` requiere acceso actual vigente, token nuevo válido y mismo `sub`; si el anterior vence durante la validación, rechazar y desconectar. Un token nuevo no tiene que superar por contrato la duración del anterior, pero no puede estar vencido. Una renovación inválida conserva las credenciales anteriores hasta su expiración, sin adoptar la identidad nueva.

El frontend será responsable de pedir a Supabase un JWT nuevo y enviarlo antes del vencimiento. La documentación recomendará renovar con margen y volver a suscribirse después de un reconnect. El servidor no promete sesiones sin cortes si la renovación del cliente falla. No se habilita recuperación automática de rooms/paquetes que salte middleware: `connectionStateRecovery` queda desactivado; reconnect autentica y suscribe nuevamente.

**Alternativas descartadas:** extender JWT en el backend vulnera el emisor; desconectar siempre para renovar interrumpe partidas; validar solo al conectar dejaría sockets vencidos recibiendo información.

### 3. Rooms autorizadas y múltiples dispositivos

Room interna `session:<sessionId>`, índice privado de sockets por identidad y sala. Ese índice administra suscripciones, no decide pertenencia del dominio. Solo `room:join` y `room:subscribe` pueden agregar el socket solicitante, después de comprobar los permisos actuales del dominio. Un usuario puede consultar varias salas legítimas, por ejemplo como host e historial, sin cambiar la exclusividad vigente de participación como jugador.

`room:join` delega en la misma incorporación transaccional que REST. `room:subscribe` valida acceso y devuelve estado sin incorporación. Los comandos del host no exigen room previa ni la agregan implícitamente; `actorId` viene del token y el dominio comprueba host aun si el socket ya pertenece a otra room.

Salida confirmada en espera, por cualquiera de los transportes: quitar de la room todos los sockets de la identidad antes del siguiente broadcast. No desconectar sus sockets completos, porque podrían observar otras salas. El ack de salida llega por su callback privado. Repetir salida conserva idempotencia; la conexión perdida solo limpia el índice de ese socket, no llama a `leave` del dominio.

**Alternativas descartadas:** confiar en el nombre de una room permite escalada; quitar solo el socket solicitante deja accesos residuales en otros dispositivos; convertir disconnect en salida rompe la reserva y reconexión acordadas.

### 4. Coordinación por sala y notificaciones después del commit

Agregar una coordinación en memoria, por `sessionId`, compartida por comandos de salas/ciclo de vida, plazos, suscripciones y salida de sockets. No serializar salas diferentes entre sí. Mantener los bloqueos PostgreSQL y su orden sala/perfil como garantía de BD; la coordinación local ordena publicación/suscripciones, no reemplaza reglas ni exclusividad transaccional.

Para join por código, resolver primero el `sessionId` sin publicar datos y entrar luego a la coordinación de esa sala; dentro de la transacción se revalida la sala/código y todas las reglas. Los códigos existentes no se reutilizan. Creación no necesita broadcast a clientes todavía no suscritos.

Dentro de una operación coordinada:
1. Abrir transacción/bloqueo de sala y ejecutar reglas existentes con el mismo `EntityManager`.
2. Capturar un resultado inmutable del cambio y el estado posterior dentro de esa transacción, incluyendo identidad retirada y transición efectiva. No conservar entidades mutables compartidas ni serializar el agregado hacia sockets.
3. Esperar commit. Si se revierte, descartar cualquier intención de notificar y no asignar nueva secuencia.
4. Aplicar revocaciones de suscripción; asignar secuencia solo si hubo cambio efectivo; generar la proyección segura y publicar en orden. La firma de imágenes ocurre fuera de la transacción y sin retener el bloqueo de BD, aunque sigue en la cola local de esa sala.
5. Devolver el resultado del comando y su envelope confirmado, no hacer un `state()` independiente desde el Gateway que podría leer otra transición.

El resultado interno de los servicios puede evolucionar para llevar snapshot/posición del cambio. Las fachadas/controladores REST deben desenvolverlo y conservar sus respuestas existentes. Los llamadores internos que antes ignoraban el retorno del ciclo de vida pueden seguir ignorándolo; actualizar tipos y tests explícitamente. La captura/persistencia pertenece al dominio/aplicación y la proyección/envío al publicador, no al Gateway.

Una suscripción entra a esa misma coordinación: comprobar acceso, preparar estado e incorporar el socket antes de soltarla; así ninguna transición se pierde entre lectura y suscripción. Revalidar acceso vigente del socket antes de activarlo. Si compite con salida, o se suscribe primero y luego es retirado, o la salida ocurre primero y la consulta lo rechaza. Joins repetidos no generan una transición nueva, pero devuelven estado actual y pueden suscribir otro dispositivo.

El publicador recibe cambios de todos los servicios y del worker, no solo handlers WebSocket. Primero emite `room:state`; luego, según estado resultante, emite apertura, revisión o fin con el mismo envelope. El cierre que por recuperación avanza inmediatamente no genera una revisión histórica; la finalización anticipada no se convierte en `question:closed`. Stale deadlines y no-op idempotentes no producen eventos. Probar también la ruta interna `evaluateAcceptedAnswers` con fixtures, sin exponerla al cliente.

Un fallo de envío después del commit no convierte un comando confirmado en fallo de negocio ni intenta repetirlo. Un fallo de proyección/firma no permite filtrar entidades como fallback: registrar el problema, mantener BD confirmada, liberar la cola y permitir nueva consulta/suscripción. Si impide construir el ack con estado, devolver `INTERNAL_ERROR` e indicar en documentación que el resultado puede estar confirmado y debe consultarse, no reintentarse ciegamente. Acotar esperas de Storage para no bloquear indefinidamente la cola.

**Alternativas descartadas:** emitir antes de commit publica estados revertidos; leer estado sin capturar el resultado puede etiquetar otra pregunta; handlers como única fuente omiten REST/plazos; un event bus asíncrono sin orden invierte estados y permite carreras de salida.

### 5. Estado seguro, reloj y orden de clientes

Reutilizar `SessionStateProjector` como única lista blanca de campos y mantener contratos REST. Crear una proyección de envelope WebSocket separada, con `remainingMs` fuera de `SessionState`. Firmar la clave capturada (TTL actual de 600 s), tomar una sola muestra de reloj después de resolver la firma y usarla tanto en `state.serverTime` como en `serverTime` y el cálculo del restante. No convertir un fallo de firma en acceso a `imageKey` ni URL pública.

`streamId` identifica una generación de stream de sala en memoria y `sequence` empieza en cero al inicializarla. Incrementar solo por cambio confirmado; consultas, rejoin idempotente y resuscripciones reutilizan posición actual. No son una versión durable de BD. Si se elimina una generación sin operaciones ni suscriptores, su recreación debe usar otro UUID, nunca reiniciar contador con el mismo stream. Reiniciar instancia cambia generaciones. Compartir una sola proyección para todos los destinatarios del mismo cambio, evitando pequeñas discrepancias de imagen/reloj entre dispositivos.

El cliente debe reemplazar estado solo si la secuencia no es más antigua dentro del mismo stream; dos eventos de igual secuencia son vistas del mismo cambio, no dos transiciones. `room:state` es suficiente para reconstruir UI; eventos específicos sirven para reaccionar a aperturas/revisión/fin. El ack inicial de `room:subscribe` establece el stream y no debe sobrescribir un evento posterior de mayor secuencia. Tras reconnect no aceptar paquetes guardados del socket anterior como estado nuevo. No exigir exactitud de milisegundos de renderizado entre pantallas, solo identidad y deadline autoritativos compartidos.

No modificar captura del quiz: la copia actual en creación cumple el snapshot previo a iniciar y se comprueba con ediciones antes y después del inicio. La retención del binario de Storage sigue siendo una limitación independiente.

**Alternativas descartadas:** agregar `remainingMs` al REST rompe su schema exacto; contador por segundo consume tráfico sin mejorar autoridad; una secuencia sin generación confunde estados tras reinicio; volver a copiar al iniciar cambia una decisión de producto ya aceptada.

### 6. Una instancia, orígenes y operación

No incorporar Redis ni cambiar el worker para múltiples réplicas. El VPS ejecutará un proceso NestJS o un contenedor, no PM2 cluster. Varias salas y sockets comparten esa instancia sin mezclarse. Documentar que aumentar réplicas exige otra propuesta de coordinación/distribución y garantías de eventos.

Compartir la lista `CORS_ORIGIN` con Socket.IO y comprobar Origin en la admisión (`allowRequest` o mecanismo equivalente) también para WebSocket, ya que CORS por sí solo no cubre ese transporte. Origen presente no configurado se rechaza; ausencia de Origin se admite solo con autenticación posterior válida. No usar wildcard por defecto. TLS se termina en el proxy del VPS y se reenvían `/socket.io/`, upgrade y polling al backend, sin reescribir el namespace. Configurar timeout del proxy compatible con heartbeat de Socket.IO. No escribir una configuración de proveedor sin conocer su proxy real: documentar requisitos y ejemplo genérico.

Hacer que el publicador esté listo antes de aceptar conexiones; recuperación de plazos en arranque sigue siendo válida aunque aún no haya suscriptores. Apagar coordinadamente conexiones, temporizadores de JWT, colas/índices y worker, sin cambiar datos persistidos.

**Alternativas descartadas:** múltiples instancias sin adaptador distribuyen sockets pero pierden broadcasts; implementar infraestructura cluster ahora excede la necesidad acordada.

## Risks / Trade-offs

- [Evento perdido entre commit y envío por caída del proceso] → Entrega no durable; nueva conexión/suscripción consulta BD y recupera el estado. No prometer replay ni exactly-once.
- [Storage lento bloquea una sala] → Timeout acotado, colas independientes por sala, no retener bloqueo BD durante firma y liberar coordinación ante fallos. El deadline persistido nunca se amplía.
- [Renovación tardía del frontend] → Documentar renovación con margen; expiración segura y reconnect explícito si falla. No fijar duración de JWT en este cambio.
- [Integración parcial deja comandos sin notificar] → Conectar los servicios compartidos, REST, worker y evaluación interna; probar origen de cada cambio y rollback.
- [Acks/broadcasts del mismo cambio procesados dos veces por UI] → Stream/secuencia comunes y contrato de reconciliación; no prometer deduplicación de efectos arbitrarios del frontend.
- [Índices o timers sobreviven al socket] → Limpieza en disconnect/shutdown y pruebas de recursos abiertos; eliminar generaciones inactivas solo cambiando su streamId al recrear.
- [Coordinación local confundida con soporte cluster] → Documentar una instancia como límite del despliegue y mantener bloqueos transaccionales existentes.
- [Cambios previos sin commit] → Implementación futura debe preservar el trabajo existente y editar solo áreas necesarias; esta propuesta no hace commit ni modifica código.

## Migration Plan

1. En apply, agregar dependencias compatibles, implementar integración y pruebas usando `TEST_DATABASE_URL` local. No aplicar cambios a Supabase productivo durante pruebas.
2. Ejecutar build, unitarias, sesiones, integración, e2e y nueva suite de sockets; revisar REST/OpenAPI y ausencia de timers/conexiones abiertos. Registrar resultados reales y bloqueos.
3. Documentar eventos, acks, renovación y reconnect para el equipo frontend, más configuración de origen y proxy de una instancia. No se necesita migración de esquema ni recaptura de salas existentes.
4. En despliegue posterior autorizado, verificar proxy TLS y una sola instancia; conexiones nuevas se autentican y suscriben. Un restart recupera deadlines persistidos sin replay de notificaciones previas.
5. Rollback: volver al backend anterior; REST/BD siguen compatibles y el worker conserva sus reglas. Los sockets se desconectarán y las pantallas deberán reconocer falta del transporte; no borrar snapshots, salas ni resultados.
