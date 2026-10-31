# ProfeLink · API de actividades

API REST del servicio de evaluaciones en vivo de ProfeLink. Permite administrar perfiles,
cuestionarios de verdadero o falso con imágenes y las copias de preguntas que usan las sesiones de
juego. La autenticación se delega a Supabase Auth, la base de datos y las imágenes viven en Supabase y
la API se despliega por separado del frontend y del servicio de juego en vivo.

## Requisitos

- Node.js 22 o superior
- npm 10 o superior
- Un proyecto de Supabase con Auth, Postgres y Storage
- (Opcional) Un colector OTLP para trazas y métricas

## Configuración

Copia `.env.example` a `.env` y completa los valores:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión de Supabase Postgres (panel → Connect) |
| `DATABASE_SSL` | No | `true` para Supabase en la nube |
| `TEST_DATABASE_URL` | Para integración, e2e y sesiones | PostgreSQL exclusivo de pruebas; nunca la misma BD que `DATABASE_URL` |
| `TEST_DATABASE_SSL` | No | SSL de la BD de pruebas, por defecto `false` |
| `SUPABASE_URL` | Sí | `https://<proyecto>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Para imágenes y seed | Clave de servicio. Solo backend, nunca en el repositorio |
| `SUPABASE_STORAGE_BUCKET` | No | Bucket de imágenes (por defecto `question-images`) |
| `PORT` | No | Puerto de la API (por defecto 3000) |
| `CORS_ORIGIN` | No | Origen(es) permitidos, separados por coma |
| `OTEL_SERVICE_NAME` | No | Nombre del servicio en la telemetría |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Si se define, se activa la exportación OTLP |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | Para el seed | Usuario de demostración |

Sin la clave de servicio la API funciona, pero las rutas de imágenes responden con error de
configuración y el seed no puede crear el usuario.

### Claves de Supabase

Supabase ofrece dos formatos de clave:

- **Nuevas** (`sb_publishable_...` y `sb_secret_...`): no son JWT. El backend las envía en el
  encabezado `apikey`, que el gateway traduce al rol correspondiente.
- **Heredadas** (empiezan con `eyJ`): son JWT. El backend las envía en `apikey` y también en
  `Authorization: Bearer`.

La lógica vive en `src/storage/service-headers.ts`, así que no hay que cambiar código al usar
cualquiera de los dos formatos. El frontend usa la clave pública (`SUPABASE_ANON_KEY`) solo para
iniciar sesión; nunca la de servicio.

## Puesta en marcha

```bash
npm install
npm run migration:run   # crea las tablas en Supabase
npm run seed            # usuario, perfil, quiz de demostración e imagen (idempotente)
npm run start:dev       # API en http://localhost:3000
```

El seed crea el bucket privado de imágenes si no existe, sube una imagen de demostración a la primera
pregunta y puede ejecutarse varias veces sin duplicar nada.

Comprobaciones rápidas:

- Salud: `GET http://localhost:3000/health`
- Documentación interactiva: `http://localhost:3000/docs`
- Especificación OpenAPI: `http://localhost:3000/openapi.json`

## Pruebas

```bash
npm test                  # unitarias, sin conexión a BD
npm run test:integration   # restricciones y relaciones, contra TEST_DATABASE_URL
npm run test:e2e           # arranque HTTP, sin usar Auth/Storage reales
npm run test:sessions      # migraciones, REST, dominio, carreras y seed idempotente
npm run test:sockets       # Socket.IO real, JWT locales y PostgreSQL de pruebas
```

Las suites que usan PostgreSQL exigen `TEST_DATABASE_URL`: si falta, fallan con un mensaje claro, no se
omiten ni usan `DATABASE_URL` como alternativa. También rechazan el mismo host/puerto/base aunque se
cambien las credenciales o parámetros. Las pruebas de concurrencia reservan conexiones independientes;
las transacciones de la suite de esquema usan un único `QueryRunner` hasta el rollback.

Para una BD local aislada, iniciar Docker Desktop y crear **un contenedor nuevo**, sin reutilizar otras BD:

```powershell
docker run -d --name profelink-pg-test-answers -e POSTGRES_USER=profelink_test -e POSTGRES_PASSWORD=profelink_local_test -e POSTGRES_DB=profelink_test -p 127.0.0.1:15433:5432 postgres:17-alpine
```

Agregar en `.env` (credenciales locales de pruebas, no de Supabase):

```dotenv
TEST_DATABASE_URL=postgresql://profelink_test:profelink_local_test@127.0.0.1:15433/profelink_test
TEST_DATABASE_SSL=false
```

Si ya existe ese contenedor, usar `docker start profelink-pg-test-answers`. El contenedor anterior
`profelink-pg-test` se conserva: su puerto 55433 quedó reservado por Windows; no es necesario borrarlo
ni detener servicios de red. El puerto nuevo está publicado solo en
localhost. La suite de sesiones crea esquemas aleatorios de pruebas y elimina únicamente esos esquemas
al terminar. Las suites anteriores aplican migraciones en la BD de pruebas y revierten los datos de cada
caso. El seed se ejecuta dos veces en un esquema aislado con servidor local simulado de Auth/Storage;
no crea usuarios ni imágenes en Supabase. Los JWT de la suite REST usan un verificador de prueba detrás
del guard real; la verificación criptográfica se cubre por las pruebas de `AuthService`.

## Migraciones

```bash
npm run migration:generate -- src/database/migrations/NombreDelCambio
npm run migration:run
npm run migration:revert
npm run migration:show
```

`synchronize` está desactivado: todo cambio de esquema debe pasar por una migración.

### Migración del motor de sesiones

`1793158800000-AddSessionLifecycle` agrega duración, cierre/revisión y reservas de jugadores; no modifica
la migración inicial. Antes de desplegar, detener escrituras y ejecutar `npm run migration:run` en una
ventana controlada. Se exige transacción (`all`, por defecto, o `each`). El preflight aborta si hay
partidas heredadas en curso, host registrado como jugador o usuarios en varias salas activas. No borra
ni corrige esos datos automáticamente: el operador debe resolverlos explícitamente antes de reintentar.

Se conservan tablas e historial; los registros anteriores reciben duración 30 y se reservan únicamente
los jugadores de salas en espera. Para revertir: detener API/procesador, volver al backend anterior y
ejecutar `npm run migration:revert`. Se eliminan solo la tabla de reservas y los nuevos metadatos; no
se reabren partidas ni se borran respuestas/resultados. **Las migraciones de desarrollo siguen usando
`DATABASE_URL`; las pruebas nunca las ejecutan sobre esa conexión.**

### Migración de respuestas, puntuación y tiempos

`1793318400000-AddAnswersScoringAndTiming` amplía la duración de respuesta a 5–120, agrega
`reviewDurationSeconds` (default 5, CHECK 3–15) y `scoredAt` interno. Conserva duración previa,
snapshots, reservas, respuestas y resultados. Los cierres históricos finalizados reciben solo la
marca de adjudicación: **no se recalculan sus puntos**, aunque sean distintos de 0/1/3.

Antes de un despliegue autorizado: respaldar, dejar terminar o finalizar explícitamente las partidas,
detener escrituras/API/worker, aplicar la migración en transacción `all` o `each` y coordinar el cliente
con el nuevo envelope. El preflight bajo bloqueo aborta ante cualquier `IN_PROGRESS` o sala `WAITING`
con preguntas jugadas/respuestas; no corrige ni finaliza salas automáticamente. Un fallo revierte el
DDL y backfill juntos.

Para revertir esta migración, detener API/worker y ejecutar `npm run migration:revert` **antes** de
reactivar el backend anterior. El down aborta si hay partidas en curso o duración de respuesta distinta
de 15/30: no convierte valores ni borra historial para forzar compatibilidad. Si es compatible, retira
los metadatos nuevos y restaura el CHECK anterior, sin tocar scores/resultados. Si no, resolver hacia
adelante o acordar una intervención explícita; no prometer rollback destructivo automático.

## Contratos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio y de la base (pública) |
| GET | `/auth/me` | Datos del token ya validado |
| GET | `/profiles/me` | Perfil propio, se crea en el primer acceso |
| PATCH | `/profiles/me` | Cambia el nombre visible |
| GET | `/quizzes` | Cuestionarios propios |
| POST | `/quizzes` | Crea un cuestionario |
| GET | `/quizzes/:id` | Detalle con preguntas ordenadas y URL firmada de imágenes |
| PATCH | `/quizzes/:id` | Edita un cuestionario propio |
| DELETE | `/quizzes/:id` | Elimina un cuestionario propio |
| POST | `/quizzes/:quizId/questions` | Agrega una pregunta |
| PATCH | `/questions/:id` | Edita enunciado, respuesta o posición |
| DELETE | `/questions/:id` | Elimina una pregunta |
| PUT | `/questions/:id/image` | Carga o reemplaza la imagen (multipart, campo `file`) |
| DELETE | `/questions/:id/image` | Elimina la imagen |
| POST | `/sessions` | Crea una sala con cuestionario propio y tiempos configurables |
| GET | `/sessions/:id` | Estado, solo host o participante |
| GET | `/sessions/:code/state` | Snapshot con ranking por código y pertenencia persistida |
| POST | `/sessions/join` | Join idempotente por código, HTTP 200 |
| DELETE | `/sessions/:id/participants/me` | Sale durante la espera, HTTP 204 |

Todas las rutas salvo `/health` y `/` exigen `Authorization: Bearer <token de Supabase>`.

Las rutas anteriores a sesiones conservan el formato estándar de NestJS:

```json
{ "statusCode": 403, "message": "No puedes modificar un cuestionario de otro usuario", "error": "Forbidden" }
```

Códigos usados: 400 validación, 401 sin token válido, 403 contenido ajeno, 404 inexistente o no
revelable, 413 archivo mayor a 2 MB.

### Salas REST

Crear (201), con un cuestionario propio y tiempos opcionales e inmutables para toda la partida:

```http
POST /sessions
Authorization: Bearer <jwt>
Content-Type: application/json

{"quizId":"<uuid>","questionDurationSeconds":15,"reviewDurationSeconds":7}
```

Respuesta: entero **5–120 segundos**, default **30**. Revisión: entero **3–15 segundos**, default **5**.
Los defaults se aplican solo al omitir el campo; null, texto, booleanos, decimales, valores fuera del
rango y campos extra se rechazan. Los cuerpos anteriores con respuesta 15/30 siguen siendo válidos.
No hay operación para editar estos tiempos. `SessionState` REST conserva sus campos: no incluye
`reviewDurationSeconds` ni `scoreboard`; los plazos efectivos sí reflejan la revisión configurada.

Unirse (200): `POST /sessions/join` con `{"code":"ABC234"}` y JWT del jugador. Se normalizan espacios
y minúsculas; nunca se acepta `userId` ni rol en el cuerpo. Un segundo join en la misma sala devuelve
el mismo participante, incluso si la partida ya empezó o está FINISHED. Un primer join después del inicio se rechaza.
El código de seis caracteres es único y no se reutiliza al terminar.

El join devuelve `{ participant, session }`; crear y consultar por id devuelven el mismo estado:

```json
{
  "id": "<uuid>", "code": "ABC234", "hostId": "<uuid>", "quizTitle": "Mi cuestionario",
  "status": "WAITING", "phase": "WAITING", "questionDurationSeconds": 15,
  "currentIndex": -1, "questionsCount": 2, "startedAt": null, "finishedAt": null,
  "serverTime": "2026-10-28T12:00:00.000Z", "participants": [], "currentQuestion": null, "results": null
}
```

`participant` contiene `id`, `sessionId`, `userId`, `displayName`, `joinedAt`. Durante una pregunta,
`currentQuestion` contiene `id`, `position`, `statement`, `imageUrl`, `status`, `openedAt`, `closesAt`,
`closedAt`, `reviewEndsAt`. **Solo en revisión** se agrega `correctBoolean`; nunca se devuelven preguntas
futuras, ni siquiera al host. En espera y al finalizar, `currentQuestion` es `null`. `results` es `null`
hasta finalizar y luego contiene `{ participantId, totalScore, rank }` por jugador. Fechas en UTC ISO 8601.

Un jugador puede pertenecer a una sola sala activa (`WAITING` o `IN_PROGRESS`). Puede abandonarla en
espera con `DELETE /sessions/:id/participants/me`; repetir la salida devuelve 204. Desconectarse durante
la partida no libera la reserva. Finalizar la sala sí la libera y conserva el historial consultable.
El host solo dirige su sala: no juega en ella ni aparece en resultados.

### Recuperación por código y telemetría

`GET /sessions/:code/state` devuelve el `RoomEnvelope` de ocho campos, con ranking y tiempos,
solo para host o jugador registrado con JWT vigente. No registra jugadores, muta la partida ni
suscribe sockets; usa `Cache-Control: private, no-store`. `GET /sessions/:id` conserva SessionState.
`room:join` y join REST recuperan al mismo participante también en FINISHED, sin otra reserva ni puntos.

El [contrato, runbook de reinicio, catálogo de métricas y guía de demostración](docs/session-recovery-and-telemetry.md)
incluye los diferidos de dispositivos físicos, VPS y Grafana, que no se consideran ejecutados.

### Máquina de estados y tiempos

```text
Sala:     WAITING --iniciar--> IN_PROGRESS --última revisión/finalizar--> FINISHED
             \----------------------finalizar--------------------------> FINISHED
Pregunta: PENDING --abrir--> OPEN --plazo/todos respondieron--> CLOSED
Fase:     WAITING            ANSWERING                       REVIEW (3–15 s) --> siguiente o FINISHED
```

- Solo el host inicia, avanza o finaliza. Inicio requiere una pregunta y un participante como mínimo;
  dos solicitudes simultáneas no inician dos veces. La copia de preguntas se fija al crear la sala.
- La pregunta cierra al plazo configurado (5–120 segundos) o cuando todos los jugadores respondieron válidamente.
  Una respuesta en el instante exacto del límite ya es tardía; el servidor es la autoridad temporal.
- Se muestra la solución durante la revisión configurada. No se aceptan respuestas nuevas en revisión ni se puede acortar
  manualmente ese período. Luego se abre automáticamente la siguiente o finaliza la partida.
- El host puede finalizar anticipadamente, sin esperar la revisión. No se abren preguntas futuras.
  Se puntúa la pregunta abierta y se suman los puntos confirmados de preguntas cerradas; omisiones
  valen cero sin respuestas ficticias. Empates usan clasificación densa: 3, 3, 1 → puestos 1, 1, 2.
- `FINISHED` es terminal. Para repetir se crea otra sala. Los temporizadores persisten sus plazos y
  se recuperan tras reiniciar; no dependen del host conectado. Después de una caída se abre como
  máximo la siguiente pregunta con tiempo completo, sin consumir preguntas nunca mostradas.

### Errores de sesiones

Formato exacto, distinto intencionalmente del de las rutas previas:

```json
{"statusCode":409,"code":"ALREADY_IN_ACTIVE_SESSION","message":"Ya participas en otra sala activa"}
```

| HTTP | Códigos |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 403 | `HOST_REQUIRED`, `HOST_CANNOT_PARTICIPATE` |
| 404 | `QUIZ_NOT_FOUND`, `SESSION_NOT_FOUND` |
| 409 | `SESSION_ALREADY_STARTED`, `SESSION_FINISHED`, `INVALID_SESSION_STATE`, `SESSION_HAS_NO_QUESTIONS`, `SESSION_HAS_NO_PARTICIPANTS`, `SESSION_NOT_JOINABLE`, `SESSION_NOT_LEAVABLE`, `ALREADY_IN_ACTIVE_SESSION`, `QUESTION_NOT_CLOSED`, `REVIEW_IN_PROGRESS`, `STALE_QUESTION` |
| 503 | `ROOM_CODE_UNAVAILABLE` |
| 500 | `INTERNAL_ERROR` |

Los clientes deciden por `code`, no por el mensaje. El catálogo detallado y los schemas están en OpenAPI.

### Integración de dominio

`SessionLifecycleService` está exportado por `SessionsModule`:

```typescript
await lifecycle.start({ actorId: user.id, sessionId });
await lifecycle.advance({ actorId: user.id, sessionId, expectedQuestionId });
await lifecycle.finish({ actorId: user.id, sessionId });
```

El actor proviene del JWT, no de un payload del cliente. Los adaptadores solo traducen datos
y errores; no deciden permisos, puntajes ni estados. Usar `SessionRoomsService.state(user, sessionId)`
para proyectar datos seguros, no serializar el agregado ni las entidades completas.

`SessionAnswersService.submit(user, { sessionQuestionId, choice })` resuelve la sala, revalida
pertenencia y respuesta previa bajo `SessionsRepository.locked`, y asigna el instante de admisión del
servidor. Inserción, evaluación de participación completa, cierre y puntuación usan el mismo
`EntityManager` y transacción, sin locks anidados. La unicidad de BD es defensa final; solo la colisión
de ese par permite un reintento acotado en transacción nueva. `processDeadline` es exclusivamente
interno y exige sala, pregunta y plazo esperados; un trabajo viejo no salta otra pregunta.

Los comandos del ciclo de vida ahora retornan internamente `CommittedSession` (snapshot capturado,
posición del stream y metadatos de notificación); los consumidores que solo esperan su finalización
pueden ignorarlo. Ese objeto es interno: no serializarlo. Los broadcasts se producen automáticamente
después del commit desde el repositorio compartido, incluidos cambios REST, respuestas y worker;
el Gateway no decide permisos, puntos ni transiciones ni emite desde un flujo paralelo.

### Socket.IO: conexión, eventos y acknowledgments

El backend ofrece **namespace `/sessions`** y **path de transporte `/socket.io`** en el mismo puerto HTTP.
No confundir el namespace con una ruta REST ni usar un cliente WebSocket puro: el protocolo es Socket.IO 4.

```typescript
import { io } from 'socket.io-client';

const socket = io(`${API_URL}/sessions`, {
  path: '/socket.io',
  autoConnect: false,
  auth: { token: accessToken }, // JWT de Supabase, sin "Bearer "
});

socket.on('room:state', applyRoom);
socket.on('question:opened', ({ state }) => showQuestion(state.currentQuestion));
socket.on('question:closed', ({ state }) => showReview(state.currentQuestion));
socket.on('scoreboard:updated', ({ scoreboard }) => showScoreboard(scoreboard));
socket.on('game:finished', ({ state }) => showResults(state.results));
socket.on('connect_error', (error) => showConnectionError(error.data));
// Registrar antes de conectar. Host o participante existente: recuperar estado.
socket.on('connect', async () => {
  if (sessionId) {
    const ack = await socket.timeout(10000).emitWithAck('room:subscribe', { sessionId });
    if (ack.ok) applyRoom(ack.data);
  } else {
    // Jugador nuevo: incorporar y suscribir solo este dispositivo.
    const ack = await socket.timeout(10000).emitWithAck('room:join', { code: 'ABC234' });
    if (ack.ok) {
      sessionId = ack.data.room.sessionId;
      applyRoom(ack.data.room);
    }
  }
});
socket.connect();
```

Registrar listeners antes de conectar. El ejemplo es orientativo: el frontend debe capturar timeouts,
errores y renovar credenciales; no se implementa una UI en este backend.

| Comando cliente → servidor | Payload exacto | `data` exitoso |
|---|---|---|
| `auth:refresh` | `{ token: "<jwt-nuevo>" }` | `{ userId, expiresAt }` |
| `room:join` | `{ code }` | `{ participant, room: RoomEnvelope }` |
| `room:subscribe` | `{ sessionId }` | `RoomEnvelope` |
| `room:leave` | `{ sessionId }` | `{ sessionId }` |
| `game:start` | `{ sessionId }` | `RoomEnvelope` |
| `game:advance` | `{ sessionId, expectedQuestionId }` | `RoomEnvelope` |
| `game:finish` | `{ sessionId }` | `RoomEnvelope` |
| `answer:submit` | `{ sessionQuestionId, choice: boolean }` | `{ answer: AnswerReceipt }` |

Los UUID y cuerpos se validan estrictamente. No enviar `userId`, `actorId`, `hostId` ni `role`; la
identidad procede del JWT y los permisos del dominio. Solo el host controla su sala, incluso si el
socket está suscrito a otras. Los comandos de control no exigen ni crean una suscripción. Los códigos
de error del dominio coinciden con REST; WebSocket no incluye `statusCode`.

Todo comando necesita callback ack (incluido `emitWithAck`); **sin callback no se ejecuta**. El resultado
tiene exactamente una de estas formas:

```json
{"ok":true,"data":{"sessionId":"<uuid>"}}
```

```json
{"ok":false,"error":{"code":"HOST_REQUIRED","message":"Solo el host puede realizar esta acción"}}
```

Un evento desconocido con callback devuelve `EVENT_NOT_SUPPORTED`. Un handshake inválido produce
`connect_error` con `error.data = { code: "UNAUTHORIZED", message }`. Los errores no se duplican en
un evento `exception`. Un timeout de ack **no demuestra que el comando no se ejecutó**: recuperar el
estado antes de reintentar. Lo mismo aplica a `INTERNAL_ERROR` posterior al commit si falló firmar
la imagen del estado; la mutación ya puede estar confirmada.

`room:state`, `question:opened`, `question:closed`, `scoreboard:updated` y `game:finished` llevan el mismo tipo de envelope:

```typescript
type RoomEnvelope = {
  sessionId: string;
  streamId: string;
  sequence: number;
  serverTime: string;
  remainingMs: number;
  reviewDurationSeconds: number;
  scoreboard: Array<{ participantId: string; totalScore: number; rank: number }>;
  state: SessionState; // mismo contrato seguro de REST, sin campos nuevos
};
```

**Cambio de contrato para frontend:** el envelope tiene exactamente estos ocho campos; el estado REST
no cambia. Cada transición publica `room:state`, luego el evento de pregunta si corresponde, luego
`scoreboard:updated` por nueva adjudicación y finalmente `game:finished` si corresponde, con igual
envelope y secuencia. Se publica scoreboard incluso si todos obtienen cero; terminar en revisión no
lo repite y terminar desde WAITING no inventa un cierre. El emisor también lo recibe si está suscrito. Una incorporación/salida
REST notifica a los sockets de esa sala; cierres y avances automáticos no dependen del host conectado.
Rejoins idempotentes, fallos revertidos y temporizadores obsoletos no generan otra transición.

#### Respuestas, recuperación de comprobantes y puntuación

Solo Socket.IO acepta respuestas, con callback obligatorio y payload exacto, sin identidad ni tiempos:

```typescript
const ack = await socket.timeout(10000).emitWithAck('answer:submit', {
  sessionQuestionId: currentQuestion.id,
  choice: true, // boolean real, no "true" ni 1
});
```

El éxito es privado al solicitante y contiene exactamente:

```json
{"ok":true,"data":{"answer":{"id":"<uuid>","sessionQuestionId":"<uuid>","choice":true,"answeredAt":"2026-10-30T12:00:00.800Z"}}}
```

No devuelve sala, solución, score ni bonus. `answer:ack` nombra conceptualmente este callback:
**no existe un evento separado** con ese nombre ni endpoint REST de respuestas. Una aceptación
intermedia no publica progreso individual ni aumenta la secuencia. Dos dispositivos de la cuenta
comparten la misma respuesta: mismo choice devuelve el id/fecha originales; cambiarlo da
`ANSWER_ALREADY_SUBMITTED`, sin sobrescribir. Tras un timeout de ack, reenviar el **mismo payload**
con JWT vigente recupera el comprobante aun en REVIEW, una pregunta posterior o FINISHED.

Precedencia tras autenticación y validación de transporte:
1. Pregunta inexistente/sala ajena: `SESSION_NOT_FOUND`; host propio: `HOST_CANNOT_PARTICIPATE`.
2. Respuesta previa: mismo choice recupera comprobante; distinto: `ANSWER_ALREADY_SUBMITTED`.
3. Nueva respuesta de pregunta ya abierta con `now >= closesAt`: `ANSWER_TOO_LATE`, aunque el worker no haya cerrado.
4. Sala finalizada: `SESSION_FINISHED`; de otro modo, si no es la pregunta actual OPEN o aún no llegó
   `openedAt`: `QUESTION_NOT_OPEN`. No se acepta después de un cierre anticipado.

Los tres errores nuevos de respuesta son conflictos (409 en el catálogo; WS no envía HTTP status).
Identidad, campos extra o tipos inválidos producen `VALIDATION_ERROR`. La hora del cliente nunca se usa.

Se adjudica **al cerrar**, usando la solución copiada: incorrecta/omisión = **0**, correcta = **1**.
El menor `answeredAt` correcto dentro de `[openedAt, openedAt + 3000 ms)` recibe **3 en total**.
Los empates exactos en ese instante comparten el bono; un error temprano no lo consume. Un primer
acierto a los 3000 ms exactos recibe solo 1; sin aciertos rápidos no hay bono. Omitir no crea Answer.
Inserción final, cierre, scores y marca de adjudicación son atómicos; los reintentos no repuntúan.

El scoreboard contiene todos los jugadores (incluido cero, excluido host), ordena total descendente
y participantId ascendente, y usa puestos densos. En WAITING todos valen cero; durante OPEN solo suma
preguntas anteriores CLOSED/puntuadas, sin revelar aciertos actuales. Tras cerrar se publica solución
y acumulado. `room:subscribe` recupera la tabla actual; en FINISHED coincide con `state.results`
persistido, incluidos puntos históricos que no se convierten a la nueva fórmula.

`remainingMs = max(0, closesAt - serverTime)` durante ANSWERING; en las otras fases vale cero. Ambos
`serverTime` coinciden y se toman después de firmar imágenes. Cada pantalla puede dibujar su contador
local ajustado a ese instante, sin pedir eventos cada segundo; solo el servidor decide cuándo cierra.
En REVIEW usar `reviewEndsAt`. OPEN nunca incluye `correctBoolean`, tampoco para el host. La solución
aparece únicamente en revisión; FINISHED tiene `currentQuestion = null` y resultados. El snapshot sigue
fijándose **al crear la sala**, no al iniciar, y las imágenes usan la clave copiada con firma temporal.

#### Renovación, varios dispositivos y reconexión

La vigencia del JWT la configura **Supabase Auth**, no el juego. Antes de vencer, el frontend debe
obtener un JWT nuevo de Supabase y enviarlo mediante `auth:refresh`; el backend no recibe refresh tokens.
Renovar con margen (por ejemplo, un minuto), no en el último instante. El nuevo token debe pertenecer a
la misma cuenta. Una renovación válida conserva socket/suscripciones y reemplaza el timer anterior;
una inválida deja el token anterior solo hasta su vencimiento original.

```typescript
// Ejecutar tras obtener el nuevo access token de Supabase, antes de expirar.
const ack = await socket.timeout(10000).emitWithAck('auth:refresh', { token: newAccessToken });
if (ack.ok) socket.auth = { token: newAccessToken }; // también para un reconnect posterior

// Si ya expiró, renovar con Supabase y conectar nuevamente.
socket.auth = { token: latestAccessToken };
socket.connect(); // después del connect, volver a room:subscribe
```

Si vence sin renovar, el servidor desconecta el socket aunque esté inactivo. La partida y reserva no
se detienen. Después de una desconexión forzada del servidor el cliente debe llamar `connect()` con
credenciales actualizadas; no confiar solo en la reconexión automática del transporte. No se restauran
rooms automáticamente ni se reproducen eventos perdidos: `room:subscribe` recupera el estado actual.

Varios dispositivos comparten participante y deadline, no crean jugadores adicionales. Cerrar una
pestaña no equivale a salir. `room:leave`, permitido solo en espera, retira de la sala **todos** los
sockets de esa identidad, también si la salida vino por REST, sin desconectarlos de otras salas.

Para reconciliar eventos/acks, comparar `sequence` únicamente dentro del mismo `streamId`: ignorar
estados más antiguos y tratar igual secuencia como el mismo cambio, no dos aperturas. El ack de
suscripción establece el stream; no debe sobrescribir un evento posterior con mayor secuencia. Un
stream nuevo tras reinicio requiere reemplazar la referencia anterior. Descartar paquetes de sockets
anteriores y no comparar secuencias entre streams. No se garantiza entrega durable ni exactly-once.

#### VPS de Hostinger: una instancia

Ejecutar **una copia** de NestJS (un proceso o un contenedor), no PM2 cluster ni varias réplicas.
Una instancia atiende múltiples salas/dispositivos. Las conexiones, streams y colas son locales; los
deadlines y partidas están en PostgreSQL. Tras reiniciar se recupera el juego y cada cliente resuscribe.
Escalar a varias instancias requiere otro cambio para distribuir broadcasts; no hay Redis en esta versión.

- Configurar `CORS_ORIGIN` con los orígenes exactos del frontend, separados por comas, sin wildcard.
  Se comprueban tanto polling como WebSocket. Clientes sin cabecera Origin también necesitan JWT.
- Usar HTTPS/WSS desde el navegador y terminar TLS en el proxy. Reenviar `/socket.io/` al mismo puerto
  del backend, sin reemplazarlo por `/sessions` ni reescribir el namespace.
- Permitir HTTP polling y el upgrade WebSocket; timeout del proxy mayor que heartbeat + margen.
  Ejemplo orientativo si el VPS usa Nginx (ajustar dominio, puerto y TLS en el servidor real):

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 75s;
}
```

Esta implementación no despliega ni modifica el VPS o Supabase. Respuestas/tiempos **sí requieren**
la migración y el preflight de reversión descritos arriba; no volver al backend anterior sin revisar
compatibilidad. Las pruebas funcionales no demuestran un máximo concurrente de producción.

## Arquitectura

- **Monolito modular** en NestJS con módulos por capacidad: `auth`, `profiles`, `quizzes`, `sessions`, `storage`.
- **Capas por módulo:** controlador (HTTP y DTO) → servicio (reglas y permisos) → repositorio TypeORM.
- **Autenticación:** Supabase Auth. La API valida el JWT contra el JWKS del proyecto con `jose`
  (firma, `iss`, `exp`, `aud = authenticated`).
- **Base de datos:** PostgreSQL de Supabase con migraciones versionadas y RLS activo sin políticas.
- **Imágenes:** bucket privado de Supabase Storage, validación de bytes reales y URL firmada de 10
  minutos.
- **Observabilidad:** OpenTelemetry con exportación OTLP de trazas y métricas.

La decisión completa, con alternativas y consecuencias, está en
`openspec/specs/` y en el archivo de diseño del cambio archivado.

## Modelo de datos

| Tabla | Propósito |
|---|---|
| `profiles` | Perfil visible del usuario; la clave es el `sub` de Supabase |
| `quizzes` | Cuestionarios y su dueño |
| `questions` | Preguntas de verdadero o falso, con posición e imagen opcional |
| `game_sessions` | Sala con código, anfitrión y estado |
| `session_questions` | Copia del enunciado, la respuesta y la imagen al crear la sesión |
| `session_participants` | Participantes de una sala, único por sesión y usuario |
| `active_session_memberships` | Reserva exclusiva por jugador mientras su sala está activa |
| `answers` | Una respuesta por participante y pregunta |
| `game_results` | Puntaje y posición final por participante |

## Limitaciones conocidas

- La imagen de demostración del seed se genera en memoria (degradado PNG) para que el seed sea
  reproducible sin archivos binarios.
- Red, cola por sala y firma de imágenes afectan el instante de admisión y el bono. La firma pública
  tiene espera acotada de cinco segundos y aún ocupa esa cola; el comprobante no añade otra firma.
  No se retrofecha, compensa con timestamps del cliente ni amplían deadlines; no se promete un SLA
  de entrega de tres segundos a pantallas.
- **Paso 7:** recuperación por código/identidad y reinicio de proceso local cubiertos; la demostración
  de reinicio del VPS permanece pendiente de autorización y ejecución real.
- **Paso 8:** métricas y ejecutor local medible disponibles; dispositivos físicos, cuenta/conexión y
  dashboards Grafana pendientes. Los reportes locales no certifican capacidad máxima productiva.
- El transporte requiere una instancia y recuperación mediante suscripción; no hay replay durable.
- Las copias conservan la clave de imagen, no una copia física del binario; borrar ese objeto en
  Storage puede afectar una imagen histórica. La retención de binarios requiere un cambio separado.
- No hay pausa, reasignación del host ni caducidad automática de salas en espera.
- `npm audit` reporta vulnerabilidades heredadas de dependencias del framework; no se aplicó
  `npm audit fix --force` para no romper versiones.

## Estructura

```
src/
  auth/          guard JWT, decoradores y endpoint /auth/me
  config/        validación de variables de entorno
  database/      opciones de conexión, data source del CLI, migraciones y seed
  health/        endpoint de salud
  profiles/      perfil del usuario autenticado
  quizzes/       cuestionarios, preguntas e imágenes
  sessions/      salas REST, dominio, estado seguro, plazos y Gateway/adaptadores en realtime/
  storage/       cliente de Supabase Storage
  docs/          configuración de OpenAPI y Scalar
  telemetry.ts   arranque de OpenTelemetry
openspec/        especificación del cambio y especificaciones archivadas
```
