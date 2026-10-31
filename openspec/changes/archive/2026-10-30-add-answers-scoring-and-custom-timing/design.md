## Context

Ver motivación y límites en `proposal.md`. El proyecto ya implementa una instancia de NestJS, JWT de Supabase, Gateway Socket.IO y deadlines persistidos. No hay cambios activos previos que continuar; los incrementos anteriores están archivados.

- `Answer` ya tiene choice booleano, answeredAt, score (default 0) y unicidad por sessionQuestionId/participantId. `GameResult` es único por sala/participante.
- `SessionsRepository.locked` combina cola local por sala con transacción y bloqueo PostgreSQL. Captura snapshots antes/después y publica tras commit. `persist` aún no guarda cambios en Answer.
- `session.rules.ts` cierra por plazo/todos, revisa cinco segundos y suma scores almacenados al finalizar; no asigna la fórmula.
- `SessionNotifications` compara estado público sin respuestas individuales; firma imágenes con espera acotada de cinco segundos y mantiene stream/secuencia. La firma aún ocupa la cola local de esa sala.
- El DTO y el CHECK de respuesta restringen 15/30. El envelope tiene seis campos; ni scoreboard ni configuración de revisión forman parte de SessionState REST.

## Goals / Non-Goals

**Goals:**
- Definir una sola ruta transaccional para aceptación, cierre, puntuación y resultados, independiente del transporte.
- Mantener comprobantes estables y privados, y proyecciones públicas de puntajes solo después de confirmar el cierre.
- Cambiar tiempos y contratos de forma explícita, preservando snapshots, unicidad, historial y comportamiento seguro del Gateway.

**Non-Goals:**
- Endpoint `GET /sessions/:code/state`, nueva API para recuperar participación por código o estado personalizado de respuestas al reconectar (paso 7). Se conservan room:join/subscribe y recuperación actuales, además del reintento idempotente acordado.
- Nuevas métricas Grafana, carga, máximo concurrente medido o demo física multidispositivo (paso 8). Sí hay pruebas de concurrencia/aislamiento para aceptar estos pasos.
- Redis, múltiples instancias, replay durable, frontend, despliegue productivo, edición de tiempos durante la partida o cambio de duración del JWT.

## Decisions

### 1. Servicio de respuestas y contrato mínimo

Agregar un servicio de dominio/aplicación para respuestas en `src/sessions/` y DTO en realtime. El dispatcher solo autentica/valida `{ sessionQuestionId, choice }` y delega. La sala se resuelve por SessionQuestion; luego se entra al mismo `locked({ id: sessionId })` que usa el ciclo de vida. La consulta inicial sirve solo para enrutamiento: dentro de la transacción revalidar pregunta, sala y participante. No tomar un segundo bloqueo de sala desde la aceptación.

Comprobante exitoso exacto:

```text
{ ok: true, data: { answer: {
  id, sessionQuestionId, choice, answeredAt
} } }
```

No incluir room, score, correctBoolean, bonus ni estado privado en ese ack. Esto evita firmar otra imagen para responder a cada clic y mantiene el comprobante idéntico antes/después del cierre. El término answer:ack corresponde al callback de answer:submit; no registrar un evento adicional con ese nombre. Identidad desde JWT y participación desde BD. Un evento con datos de identidad o score suministrados por cliente falla validación.

**Alternativas descartadas:** aceptar sessionId además de pregunta agrega combinaciones incoherentes; devolver entidad Answer filtra score; un endpoint REST de respuestas o evento extra de ack duplica transporte sin necesidad acordada.

### 2. Precedencia y reloj de aceptación

Dentro de exclusión y usando el mismo EntityManager:
1. Verificar pregunta/sala y pertenencia; ajeno/inexistente → SESSION_NOT_FOUND; host propio → HOST_CANNOT_PARTICIPATE. No devolver existencia de respuesta antes de autorizar.
2. Buscar respuesta del par. Mismo choice → devolver comprobante original; distinto → ANSWER_ALREADY_SUBMITTED, aunque la pregunta ya haya cerrado.
3. Para una respuesta nueva, tomar una muestra de SessionClock tras cargar los datos necesarios, inmediatamente antes de validar e insertar. Si la pregunta ya se abrió y now >= closesAt → ANSWER_TOO_LATE; luego comprobar sala finalizada → SESSION_FINISHED; finalmente IN_PROGRESS, pregunta actual OPEN y now >= openedAt → de otro modo QUESTION_NOT_OPEN.
4. Insertar con answeredAt = now y score inicial 0 (todavía no adjudicado). Agregar la respuesta al agregado usado por la política de cierre, o volver a leerlo usando la misma conexión.
5. Evaluar cierre por participación completa con la política compartida. Persistir todos los efectos antes del commit; no llamar al método de servicio que vuelve a tomar el mismo bloqueo.

No se permite backdating a la hora de envío del cliente ni a una recepción previa a la cola: el instante autoritativo es el de admisión bajo exclusión. Para el bono usar milisegundos persistidos por el servidor, no precisión distinta del timestamp del cierre.

La restricción única existente es defensa final, no sustituye la serialización. Si un escritor concurrente ajeno a este flujo causa unique violation, no consultar en una transacción PostgreSQL abortada: revertir y recuperar/revalidar el registro con una transacción nueva bajo el mismo protocolo, con reintento acotado. No enmascarar otras violaciones de BD como duplicados.

**Alternativas descartadas:** comprobar OPEN antes de duplicado rechaza comprobantes legítimos perdidos; tiempo de cliente permite inventar rapidez; comprobar solo estado sin deadline acepta respuestas tardías mientras el worker se retrasa.

### 3. Puntuación al cerrar, sin sumas incrementales

Agregar `scoredAt: timestamptz nullable` interno a SessionQuestion, no expuesto en REST/WS. Sirve para distinguir puntuación pendiente del cero válido y volver inequívoco que una pregunta cerrada ya fue adjudicada.

Una política pura compartida de cierre toma pregunta, jugadores, respuestas aceptadas y reloj. Al pasar OPEN a CLOSED:
- Fijar closedAt efectivo y reviewEndsAt con la duración de sala.
- Seleccionar solo respuestas de esa pregunta y participantes de esa sala, aceptadas en `[openedAt, closesAt)` y no posteriores al cierre efectivo.
- Identificar aciertos usando correctBoolean del snapshot; de los aceptados en `[openedAt, openedAt + 3000 ms)`, elegir menor answeredAt y todos sus empates exactos. Asignar score 3 a esos ganadores, 1 a otros aciertos y 0 a errores. Un error temprano no consume el bono.
- Fijar scoredAt al instante real de puntuación y persistir cambios junto con la transición. Si scoredAt ya existe, no adjudicar de nuevo ni actualizar un acumulado.

Todos los cierres deben llamar esa política: última respuesta, deadline, evaluación interna existente y finish anticipado. La recuperación actual puede cerrar una pregunta atrasada y abrir como máximo la siguiente en una transacción: puntuar la anterior aunque su revisión ya pasó, sin emitir una solución histórica.

Extender persistencia para guardar los scores modificados con el mismo manager. No hacer updates después de liberar el lock, ni asignar score en el Gateway. No agregar un CHECK global 0/1/3 sobre Answer.score que invalide scores históricos de otros incrementos. Nuevas adjudicaciones se limitan por la política y sus pruebas.

Al terminar, derivar GameResult de la suma de respuestas puntuadas de preguntas cerradas. Mantener único sala/participante y puesto denso, y guardar un resultado por jugador, incluido cero. No ejecutar `totalScore += ...`; no guardar GameResult parcial. Un fallo de guardado revierte respuesta final, scores, cierre, resultados y liberación de reserva juntos.

**Alternativas descartadas:** usar score = 0 como marca no distingue error de pendiente; puntuar en recepción puede filtrar aciertos y complica bono/empates; sumar por evento duplica puntos con reintentos. Una tabla de scoreboards persistidos no es necesaria para derivar estos acumulados.

### 4. Clasificación derivada y eventos de un mismo cambio

Crear un proyector puro de scoreboard que use todos los participantes excepto host y solo preguntas CLOSED con scoredAt, sumando respuestas válidas. Para FINISHED usar los GameResult persistidos, lo que preserva resultados históricos y garantiza igualdad con state.results. En WAITING todos valen cero; ordenar totalScore DESC y participantId ASC, con ranks densos. Durante una nueva pregunta el scoreboard permanece en los totales del cierre anterior.

Ampliar el envelope externo, no SessionState:

```text
RoomEnvelope = {
  sessionId, streamId, sequence, serverTime, remainingMs,
  reviewDurationSeconds,
  scoreboard: [{ participantId, totalScore, rank }],
  state: SessionState
}
```

La posición del stream y la proyección se siguen compartiendo entre eventos de un cambio. Ampliar metadatos internos de CommittedSession para identificar nuevas preguntas puntuadas, no solo comparar los totales: si todos fallan sigue existiendo una actualización por cierre. Publicar en este orden: room:state; question:opened o question:closed si corresponde; scoreboard:updated cuando se confirmó al menos una nueva puntuación; game:finished al final si corresponde. Todos llevan igual envelope/secuencia. Finish durante revisión no repuntúa ni repite scoreboard:updated; finish desde WAITING publica finalización con ceros sin inventar un cierre.

Mantener respuestas fuera de la comparación pública cuando no hay cierre: una inserción intermedia genera solo comprobante, sin aumentar la secuencia ni publicar conteo, elecciones o puntajes. El marcador scoredAt y transición sí permiten detectar un cierre público. La recuperación existente por room:subscribe recibe un envelope fresco con scoreboard, sin nuevo endpoint, replay ni registro de jugador.

Mantener pertenencia, revocación al salir, expiración JWT y aislamiento del hub en los cinco tipos de notificación. Fallo de envío/proyección después del commit no revierte ni repite puntuación. La respuesta aceptada no depende de conseguir firmar una imagen de su comprobante, que no la contiene; el publicador conserva su timeout, registro y recuperación por suscripción.

**Alternativas descartadas:** exponer la clasificación en GET /sessions/:id cambia el contrato descartado por el usuario; mostrar aciertos antes del cierre filtra solución; emitir solo cuando varían los totales omite cierres de cero puntos.

### 5. Tiempos de sala y compatibilidad de clientes

Crear límites/defaults explícitos de respuesta (5–120, 30) y revisión (3–15, 5); reemplazar el alias de duración limitado a 15|30 por un tipo numérico validado en el borde. Normalizar únicamente `undefined` a default. Rechazar null, texto, booleanos, decimales y campos extra, sin coerción implícita. Persistir reviewDurationSeconds en GameSession y usarlo en todos los lugares que hoy consumen REVIEW_DURATION_MS fijo, incluido finish, avance y recuperación existente.

OpenAPI de creación debe reflejar ambos campos opcionales, rangos enteros y defaults. Los cuerpos antiguos 15/30 siguen funcionando; omitir respuesta ahora es válido con 30. No se agrega endpoint PATCH de configuración. El proyector REST conserva sus campos exactos; questionDurationSeconds permite todo el rango, y reviewEndsAt refleja la configuración. Solo el envelope WS añade reviewDurationSeconds y scoreboard. Esta ampliación de un contrato exacto requiere coordinar lectores frontend y adaptar tests de claves exactas.

**Alternativas descartadas:** seguir enumerando 15/30 contradice el acuerdo; poner revisión en cada pregunta permite configuraciones heterogéneas no pedidas; aceptar null como default oculta payloads incorrectos.

### 6. Migración conservadora y datos heredados

Crear una migración nueva, sin editar las anteriores, bajo transacción y con bloqueo de tablas afectadas durante preflight/DDL/backfill. Antes de aplicar exigir cero salas IN_PROGRESS: cambia una política de juego y no se transformarán partidas a mitad. Rechazar también salas WAITING con respuestas o preguntas ya abiertas/cerradas, porque no son una espera limpia; no resolverlas automáticamente.

Agregar reviewDurationSeconds con default 5 y CHECK 3–15; reemplazar CHECK de respuesta por BETWEEN 5 AND 120 conservando valores; agregar scoredAt. Marcar CLOSED de salas FINISHED heredadas como adjudicadas usando COALESCE(closedAt, finishedAt, createdAt de sala), sin tocar choice, answeredAt, score o GameResult. No interpretar scores históricos (por ejemplo 100) como si hubieran sido adjudicados con la fórmula nueva. No recapturar quizzes ni modificar reservas/participantes/snapshots.

La reversión también requiere API/worker detenidos y preflight: si hay partidas IN_PROGRESS o cualquier duración almacenada distinta de 15/30, abortar sin convertir valores ni borrar historial para satisfacer el CHECK antiguo. Si es compatible, restaurar la restricción anterior y retirar solo nuevos metadatos. Las salas con tiempo custom pueden exigir solución hacia adelante o decisión explícita del operador; no prometer rollback destructivo automático ni sobrescribir el puntaje de un cierre.

**Alternativas descartadas:** recalcular todo el historial destruye resultados previos; migrar una partida abierta mezcla fórmulas; corregir duraciones a 30 silenciosamente viola inmutabilidad e historial.

### 7. Latencia y límite de los pasos siguientes

No introducir un nuevo sistema de colas ni replay como parte de respuestas. Reutilizar el orden de sala y el límite de firma actual, evitando nuevas firmas en acks y en respuestas que no cierran. El reloj de admisión toma en cuenta espera real: una imagen lenta o latencia puede afectar aceptación/bono, pero nunca habilita timestamps falsos ni extiende un deadline. Probar la cola con retrasos deterministas; documentar esta limitación sin afirmar un SLA de tres segundos de entrega a pantallas.

Los tests de estos pasos emplean dos salas y múltiples sockets para comprobar corrección, no para declarar capacidad máxima de producción. No agregar instrumentos/etiquetas de métricas, paneles Grafana ni datos de carga inventados. El endpoint por código, rehidratación personalizada de respuestas y demo de reinicio del VPS se mantienen como trabajo del paso 7; el acumulado se puede consultar por los mecanismos ya existentes.

## Risks / Trade-offs

- [Latencia/red/cola influye en rapidez] → Tiempo del servidor al admitir bajo lock, ventana estricta de 3000 ms, sin compensación de reloj cliente; no añadir firmas al ack ni prometer una medición justa independiente de red.
- [Cero usado antes del cierre se confunde con puntaje final] → scoredAt y proyección solo de preguntas cerradas; no exponer score en el comprobante.
- [Empates de timestamp otorgan varios bonos] → Es la política aceptada, determinista al recalcular desde respuestas persistidas, sin desempate arbitrario.
- [Ack perdido después del commit] → Mismo choice recupera comprobante original aun en FINISHED; otro choice no modifica nada.
- [Clase de notificación solo reconoce un evento por cambio] → Añadir metadatos de nuevas puntuaciones y emisión ordenada con secuencia común, sin confundir cierre con variación numérica.
- [Migración encuentra juegos en curso o rollback incompatible] → Preflight aborta sin modificar datos; documentar ventana controlada y preferir corrección hacia adelante.
- [Tests antiguos usan puntos arbitrarios/tiempos fijos] → Conservar fixtures históricos explícitos y adaptar los nuevos a reglas 0/1/3; no borrar pruebas para hacer pasar el cambio.
- [Trabajo anterior sin commit] → La implementación debe preservar modificaciones previas, sin reset, commit ni push implícito.

## Migration Plan

1. En apply, implementar y verificar migración en TEST_DATABASE_URL local, incluyendo preflight, backfill, rollback compatible e incompatible; nunca en producción por ejecutar pruebas.
2. Implementar reglas/servicio, persistencia atómica y proyecciones/eventos; ejecutar regresión de unitarias, REST, sesiones, Socket.IO, integración y e2e.
3. Actualizar README/OpenAPI con fórmula, ventanas, errores, defaults, cambio de envelope y alcance pendiente 7/8. No crear telemetría ni inventar un máximo concurrente probado.
4. Despliegue posterior y autorizado: dejar terminar/finalizar explícitamente partidas activas, detener escrituras/API/worker, hacer respaldo, aplicar migración y coordinar cliente compatible con nuevo envelope. No finalizar partidas automáticamente como parte de la migración.
5. Si falla antes de commit, rollback transaccional. Si requiere volver a backend anterior, aplicar primero el preflight documentado de reversión y detenerse ante datos incompatibles; no eliminar resultados/custom durations para forzarla.
