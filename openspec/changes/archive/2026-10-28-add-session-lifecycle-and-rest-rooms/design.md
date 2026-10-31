## Context

Ver `proposal.md` para la motivación y `specs/session-lifecycle/spec.md` y `specs/session-rooms/spec.md` para los comportamientos normativos. El proyecto tiene autenticación JWT global, perfiles creados de forma idempotente y entidades de sesiones, preguntas copiadas, participantes, respuestas y resultados, pero no un módulo funcional de sesiones. Ya existen índices únicos para código, `(sessionId, userId)`, `(sessionId, position)`, respuestas y resultados.

El índice de participantes no limita a un usuario entre salas. Las entidades tampoco registran duración por sala, cierre efectivo ni fin de revisión. El catálogo actual de pruebas de integración usa `DATABASE_URL`; se necesita una configuración explícita de pruebas para las nuevas pruebas que escriben y migran. No se ejecutarán contra la base compartida de desarrollo por defecto.

## Goals / Non-Goals

**Goals:**
- Transiciones transaccionales y comprobables con reloj inyectable, sin reglas en controladores o futuros Gateways.
- Contratos REST completos y una interfaz de dominio reutilizable por los siguientes pasos de P2/P3/P4.
- Exclusión respaldada por PostgreSQL, también entre procesos, y recuperación de plazos sin requerir Redis.
- Mantener las rutas existentes y sus formatos de error sin cambios incompatibles.

**Non-Goals:**
- Gateway, eventos públicos, acks WebSocket, frontend y despliegue de un clúster de tiempo real.
- Recepción pública de respuestas, fórmula de puntos, bonificaciones por velocidad o sanciones nuevas.
- Expulsiones, reasignación del host, pausas, reinicios, sala de espectadores o límite de salas dirigidas.
- Borrar automáticamente salas en espera ni liberar jugadores por desconexión.

## Decisions

### 1. Módulo de sesiones con dominio reutilizable

Crear un módulo de sesiones con controlador REST delgado, coordinación de aplicación, repositorio transaccional, políticas puras de transición, proyector de estado y procesador de plazos. Reutilizar el usuario autenticado del guard y el servicio de perfiles. No aceptar actor, host ni participante desde el cuerpo del cliente.

Comandos de dominio previstos, sin crear rutas REST adicionales para ellos:
- Iniciar: actor y sala.
- Avanzar: actor, sala y pregunta esperada.
- Finalizar: actor y sala.
- Evaluar todas las respuestas aceptadas: sala y pregunta esperada; solo uso interno, no un endpoint de respuesta.
- Procesar plazo: sala, pregunta esperada, tipo de plazo e instante de evaluación.

El futuro envío de respuestas deberá validar identidad, participación, plazo y unicidad en su propia transacción, y coordinar la aceptación con el bloqueo de la sala antes de solicitar el cierre por todos respondidos. En esta etapa la integración se prueba preparando respuestas aceptadas, no simulando que existe un contrato `answer:submit` ya acordado.

Alternativa descartada: un controlador/Gateway que consulte repositorios y decida estados; duplicaría reglas y permitiría diferencias entre transportes.

### 2. Tabla de transiciones y precedencia

| Acción | Precondiciones | Efecto |
| --- | --- | --- |
| Crear | JWT, cuestionario propio, duración válida | Sala `WAITING`, índice -1, copia de preguntas `PENDING` |
| Iniciar | Host, `WAITING`, preguntas y participantes >= 1 | `IN_PROGRESS`, `startedAt`, índice 0, primera pregunta `OPEN` |
| Cerrar por plazo | `IN_PROGRESS`, pregunta esperada `OPEN`, ahora >= `closesAt` | `CLOSED`, cierre efectivo = `closesAt`, revisión hasta cierre + 5 s |
| Cerrar por todos | `IN_PROGRESS`, pregunta esperada `OPEN`, todos respondieron antes del plazo | `CLOSED`, cierre efectivo = última respuesta aceptada, revisión + 5 s |
| Avanzar | Host o procesador interno, pregunta esperada `CLOSED`, revisión vencida | Abrir siguiente con nuevos plazos, o finalizar si era la última |
| Finalizar explícitamente | Host, `WAITING` o `IN_PROGRESS` | `FINISHED`, cerrar pregunta abierta, guardar resultados y liberar reservas |

Precedencia de los comandos del host: autenticar → localizar sala → comprobar host → estado terminal → estado requerido → precondiciones específicas. En `IN_PROGRESS`, repetir inicio devuelve `SESSION_ALREADY_STARTED`; en `FINISHED`, cualquier comando del host devuelve `SESSION_FINISHED`. Un actor no host recibe `HOST_REQUIRED`, sin ejecutar cambios.

El avance lleva la pregunta esperada para que una solicitud atrasada no opere sobre la nueva pregunta: si cambió, devolver `STALE_QUESTION`. Los trabajos internos obsoletos son no-op. Finalizar explícitamente es una excepción intencional a la revisión: termina inmediatamente, incluso durante esos cinco segundos.

Alternativa descartada: agregar estado persistido de sala `REVIEW`; la fase se deduce de la pregunta cerrada y del plazo, sin ampliar los estados existentes.

### 3. Datos persistidos y finalización

Agregar mediante una nueva migración:
- `game_sessions.questionDurationSeconds`, entero con restricción 15/30; las salas nuevas exigen valor explícito. Valor de compatibilidad para historial existente: 30.
- `session_questions.closedAt` y `reviewEndsAt`, tiempos anulables. `closesAt` sigue siendo el límite de respuesta originalmente concedido; no se sobrescribe con el cierre temprano.
- `active_session_memberships`: `userId` como clave primaria y `sessionId`; clave foránea compuesta hacia el participante `(sessionId, userId)` y borrado en cascada al eliminar esa incorporación. Activar RLS sin políticas públicas, igual que las tablas actuales.

Al finalizar, sumar `answers.score` de preguntas de esta sesión que tengan `openedAt`, con unión desde todos sus participantes para incluir a quienes no respondieron. Insertar un único `game_results` por participante dentro de la misma transacción que marca `FINISHED` y elimina las reservas activas. Usar clasificación densa por puntaje descendente; los empates comparten puesto. No se calcula el valor de una respuesta correcta en este cambio y no se generan filas de respuestas para ausencias.

En finalización anticipada, las preguntas nunca abiertas continúan `PENDING` y no se publican ni puntúan. La finalización desde `WAITING` deja `startedAt = null` y resultados en cero. El host puede cancelar así una sala en espera cuyos jugadores quieran liberarse. No hay transición automática por desconexión ni vencimiento de una sala en espera.

Alternativas descartadas: agregar un booleano activo al participante sin restricción global (no impide dos salas), o un índice parcial que consulte el estado de otra tabla (no expresa esta unicidad directamente). La reserva separa historial y exclusividad sin borrar partidas terminadas.

### 4. Concurrencia y orden de bloqueo

Usar una transacción y su conexión dedicada para cada comando; todas sus consultas pasan por ese mismo contexto transaccional. Bloquear la fila de sala antes de evaluar o cambiar participantes/estado. En joins y salidas, después del bloqueo de sala bloquear el perfil del jugador para serializar sus reservas entre salas; las restricciones únicas son la última defensa.

Para join: localizar código → bloquear sala → rechazar al propio host y una sala finalizada → buscar participante existente → devolverlo si ya estaba, incluso en `IN_PROGRESS` → exigir `WAITING` para un participante nuevo → bloquear perfil → comprobar reserva global → insertar participante y reserva. Una violación de unicidad conocida se traduce al error correspondiente, nunca en SQL crudo. La finalización elimina reservas solo de su sala; no necesita adquirir bloqueos de perfiles ni bloquear otras salas. Mantener este orden en todas las operaciones para reducir interbloqueos.

La salida y el inicio comparten bloqueo de sala: el inicio ve la lista definitiva o la salida ve que la partida ya inició. Las lecturas de estado usan una vista consistente para no mezclar participantes de una transacción con pregunta de otra.

Crear la sala y copiar preguntas bajo una instantánea transaccional consistente del cuestionario y sus preguntas; insertar código bajo su índice único. Generar códigos con aleatoriedad criptográfica, seis símbolos del alfabeto indicado en el spec y hasta 10 intentos con transacción nueva o punto de guardado tras cada colisión. No intentar continuar una transacción PostgreSQL abortada por una violación de unicidad.

Alternativa descartada: mutex en memoria; no protege entre procesos ni tras reinicios. No se elimina ningún índice ya existente.

### 5. Reloj, revisión y recuperación

Usar un reloj de servidor inyectable en dominio y pruebas. Persistir todos los plazos en UTC; el cliente solo presenta la cuenta regresiva con `serverTime`, nunca decide si una respuesta llegó a tiempo. El criterio temporal es estricto: aceptación anterior a `closesAt`.

Un procesador periódico del servidor descubre salas con plazos vencidos y vuelve a comprobarlos dentro de la transacción con bloqueo de sala. Los temporizadores en memoria, si se usan para reducir latencia, son solo una optimización. Al arrancar, ejecutar recuperación y seguir explorando pendientes. Distintas instancias pueden descubrir el mismo plazo: el bloqueo y la pregunta esperada garantizan un solo efecto.

Si el servidor se retrasa, cerrar por vencimiento con `closedAt = closesAt` y `reviewEndsAt = closesAt + 5 s`. Si la revisión ya venció, abrir la siguiente al tiempo real de procesamiento, otorgándole sus 15/30 segundos completos; no consumir preguntas nunca presentadas para alcanzar el reloj. No prometer latencia cero: nunca avanzar antes del plazo de revisión y procesar después tan pronto el servidor esté operativo.

Los temporizadores siempre llevan sala, pregunta y plazo esperado. Un temporizador atrasado no afecta una pregunta nueva ni una sala finalizada. Limpiar recursos al detener el módulo para evitar handles abiertos en Jest.

Alternativa descartada: una cadena de `setTimeout` como única autoridad, que perdería plazos al reiniciar. No incorporar cola externa en este incremento.

### 6. Contratos REST y proyección

| Ruta | Entrada | Éxito |
| --- | --- | --- |
| `POST /sessions` | `{ quizId: UUID, questionDurationSeconds: 15 o 30 }` | 201, `SessionState` |
| `GET /sessions/{id}` | UUID en ruta | 200, `SessionState` |
| `POST /sessions/join` | `{ code: string }` | 200, `{ participant: Participant, session: SessionState }` |
| `DELETE /sessions/{id}/participants/me` | UUID en ruta, sin cuerpo | 204, sin cuerpo |

`Participant` contiene exactamente `id`, `sessionId`, `userId`, `displayName`, `joinedAt`; nombre copiado del perfil al incorporarse. Normalizar el código con trim y mayúsculas antes de validar longitud/alfabeto. Los DTO rechazan campos desconocidos, incluido `userId`. La duración es requerida y no se transforma texto en número. Un cuestionario vacío puede producir una sala en espera, pero no puede iniciarla; se puede cancelar y crear otra después de corregirlo.

`SessionState` contiene exactamente:
- `id`, `code`, `hostId`, `quizTitle`, `status`, `phase`, `questionDurationSeconds`, `currentIndex`, `questionsCount`.
- `startedAt`, `finishedAt`, `serverTime` como ISO 8601 UTC o `null` según corresponda; `serverTime` siempre presente y no nulo.
- `participants`: lista de `Participant`, orden estable por `joinedAt` e `id`.
- `currentQuestion`: `null` en espera/final; durante respuesta o revisión: `id`, `position`, `statement`, `imageUrl`, `status`, `openedAt`, `closesAt`, `closedAt`, `reviewEndsAt`. Solo en revisión agregar `correctBoolean`; antes no incluir la clave.
- `results`: `null` antes de finalizar; después lista de `{ participantId, totalScore, rank }`, ordenada por puesto e identificador para empates.

`phase` se deriva: `WAITING`, `ANSWERING` (pregunta abierta), `REVIEW` (pregunta cerrada), `FINISHED`. Una demora del procesador no autoriza nuevas respuestas después de `closesAt`, incluso si la última proyección seguía mostrando `ANSWERING`. Firmar URLs de imagen con el servicio existente; no serializar entidades completas, claves internas de almacenamiento ni preguntas futuras. La copia mantiene la referencia de imagen según el comportamiento actual; la conservación del objeto binario frente a borrados externos no se resuelve aquí.

Alternativa descartada: retornar la entidad con relaciones completas; filtraría soluciones y acoplaría el contrato al esquema.

### 7. Catálogo de errores

Error REST exacto para rutas nuevas: `{ statusCode: number, code: string, message: string }`. Mensaje legible en español; el cliente decide por `code`, no por texto. El mapeo se limita a sesiones, incluyendo fallos que ocurren en guard, validación y parseo, sin alterar otras rutas. Verificar con pruebas HTTP que el manejo incluya también errores anteriores al controlador.

| Código | HTTP | Condición |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | JWT ausente, inválido o vencido |
| `VALIDATION_ERROR` | 400 | UUID, código, duración, cuerpo o campos extra inválidos |
| `QUIZ_NOT_FOUND` | 404 | Cuestionario inexistente o ajeno al crear |
| `SESSION_NOT_FOUND` | 404 | Sala/código inexistente o consulta de estado no autorizada |
| `HOST_REQUIRED` | 403 | Comando de control por no host |
| `HOST_CANNOT_PARTICIPATE` | 403 | Join/salida de jugador por el propio host |
| `SESSION_ALREADY_STARTED` | 409 | Inicio repetido en `IN_PROGRESS` |
| `SESSION_FINISHED` | 409 | Join o control sobre sala finalizada |
| `INVALID_SESSION_STATE` | 409 | Comando no permitido en la fase actual |
| `SESSION_HAS_NO_QUESTIONS` | 409 | Inicio sin preguntas copiadas |
| `SESSION_HAS_NO_PARTICIPANTS` | 409 | Inicio sin jugadores |
| `SESSION_NOT_JOINABLE` | 409 | Primer join durante partida |
| `SESSION_NOT_LEAVABLE` | 409 | Salida fuera de espera |
| `ALREADY_IN_ACTIVE_SESSION` | 409 | Jugador con reserva en otra sala activa |
| `QUESTION_NOT_CLOSED` | 409 | Avance mientras la pregunta sigue abierta |
| `REVIEW_IN_PROGRESS` | 409 | Avance antes de cinco segundos de revisión |
| `STALE_QUESTION` | 409 | Comando de avance para una pregunta que ya cambió |
| `ROOM_CODE_UNAVAILABLE` | 503 | Diez colisiones de generación de código |
| `INTERNAL_ERROR` | 500 | Fallo inesperado sin datos internos en la respuesta |

Los códigos de comandos sin ruta REST son errores de dominio con este mapeo previsto; no implican crear endpoints adicionales. La especificación futura de respuestas definirá sus propios errores de duplicidad y tardanza, conservando las reglas temporales de esta base.

### 8. Convenciones acotadas para cerrar el contrato

Como detalles no definidos por el usuario, se adoptan código de seis caracteres, join 200 tanto nuevo como repetido, duración obligatoria sin valor por defecto para peticiones nuevas, clasificación densa en empates, y permiso de consultar historial a participantes. No se prohíbe dirigir múltiples salas: la restricción acordada se aplica a jugar. El host no puede jugar en su propia sala, independientemente de otras reservas.

## Risks / Trade-offs

- [Jugadores bloqueados en una sala `WAITING` abandonada por el host] → Salida explícita en espera y finalización por host; no agregar una caducidad no acordada.
- [Caída temporal del servidor] → Plazos persistentes y recuperación; no se garantiza revisión visible durante una caída, pero nunca se abre anticipadamente ni se inventan respuestas.
- [Futuro ingreso de respuestas que ignore el bloqueo de sala] → Documentar el punto de integración y probar con una segunda conexión; aceptación y cierre deberán coordinarse en ese mismo agregado.
- [Migración con participación histórica incompatible] → Preflight y aborto claro, sin eliminar jugadores, reasignar salas ni finalizar partidas silenciosamente.
- [Fuga de respuestas correctas] → Proyección explícita y tests sobre claves ausentes tanto para host como para participantes.
- [Pérdida de binarios referenciados por copias] → Registrar limitación actual de Storage y tratar retención de imágenes en un cambio separado, sin afirmar copia física del objeto.
- [Puntuación aún no definida] → Solo sumar puntos almacenados y comprobar omisiones en cero; no presentar este cambio como implementación completa de `answer:submit`.
- [Pruebas de concurrencia falsas con transacciones compartidas] → Base de pruebas dedicada y conexiones independientes para cada actor concurrente.

## Migration Plan

1. Preparar y documentar una URL exclusiva de pruebas (`TEST_DATABASE_URL`) y un comando de suite de sesiones que falle si no está definida; no recurrir a `DATABASE_URL`. No ejecutar migraciones destructivas sobre la base de desarrollo para validar esta propuesta.
2. Antes de migrar un despliegue existente, detener escrituras. Verificar que no existan salas `IN_PROGRESS` heredadas, usuarios en varias salas activas ni host incorporado como jugador. Ante conflictos, abortar y pedir resolución explícita al operador; no borrar datos automáticamente. El backend anterior aún no tiene motor público de partidas: no se intenta reconstruir automáticamente una partida activa insertada manualmente.
3. Aplicar migración incremental: columnas, restricciones, tabla de reservas, índices y RLS. Mantener duración 30 para registros existentes; nuevas peticiones deben enviar duración. Rellenar reservas de participantes de salas `WAITING` únicamente después del preflight. Las salas `FINISHED` no reservan jugadores.
4. Desplegar módulo, controladores y procesador de plazos. Verificar creación/join/consulta/salida y dos salas independientes. No desplegar WebSocket en este incremento.
5. Validar migración desde una base de pruebas vacía, actualización con historial terminado y rechazo seguro ante conflictos heredados. Comprobar que los tests y seeds existentes sigan pasando.
6. Rollback: detener procesadores y escrituras, volver al backend anterior y revertir solo esta migración en una ventana controlada. La reversión elimina reservas y nuevos metadatos temporales pero conserva las tablas históricas previas; advertir que un nuevo despliegue requerirá otra vez preflight. No reabrir partidas terminadas.
