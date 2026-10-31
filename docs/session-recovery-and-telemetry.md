# Recuperación, reinicio y telemetría

## Contratos P3/P4

El dominio valida permisos, respuestas, puntos y transiciones. El Gateway solo autentica, adapta
transporte y observa métricas; no contiene reglas del juego.

| Operación | Entrada | Éxito |
|---|---|---|
| HTTP `GET /sessions/:code/state` | código + JWT Bearer | HTTP 200, `RoomEnvelope` directo |
| HTTP `GET /sessions/:id` | UUID + JWT Bearer | `SessionState` anterior, sin nuevos campos |
| HTTP `POST /sessions/join` | `{ code }` + JWT | `{ participant, session }` |
| WS `room:join` | `{ code }` | `{ ok: true, data: { participant, room } }` |
| WS `room:subscribe` | `{ sessionId }` | `{ ok: true, data: RoomEnvelope }` |
| WS `game:start` / `game:finish` | `{ sessionId }` | `{ ok: true, data: RoomEnvelope }` |
| WS `game:advance` | `{ sessionId, expectedQuestionId }` | `{ ok: true, data: RoomEnvelope }` |
| WS `answer:submit` | `{ sessionQuestionId, choice: boolean }` | `{ ok: true, data: { answer: { id, sessionQuestionId, choice, answeredAt } } }` |

`answer:ack` **es el callback de answer:submit, no otro evento**. Sin callback no se ejecutan comandos.
La identidad procede del JWT; no se aceptan userId, participantId ni roles declarados en payload.

Envelope exacto: `sessionId`, `streamId`, `sequence`, `serverTime`, `remainingMs`,
`reviewDurationSeconds`, `scoreboard`, `state`. Filas exactas: `{ participantId, totalScore, rank }`.
state conserva SessionState. OPEN no incluye soluciones ni respuestas individuales; scoreboard solo
suma cierres puntuados. Consultas independientes pueden variar tiempo/firma sin representar otro cambio.

GET por código normaliza espacios exteriores/minúsculas, exige host o participación persistida y
responde `Cache-Control: private, no-store`. No crea jugadores, reservas o suscripciones, no incrementa
secuencia ni ejecuta transiciones. Puede devolver OPEN vencida con remainingMs 0 antes del worker.
No compartir/cachar snapshots entre cuentas. GET por id conserva su respuesta anterior.

Errores HTTP exactos: `{ statusCode, code, message }`. WS: `{ ok: false, error: { code, message } }`.
Handshake inválido usa connect_error/error.data. El catálogo completo sigue en OpenAPI/README.

| Código | Caso de recuperación / HTTP equivalente |
|---|---|
| `UNAUTHORIZED` | JWT ausente, inválido o vencido / 401 |
| `VALIDATION_ERROR` | Código o payload inválido / 400 |
| `SESSION_NOT_FOUND` | Consulta ajena o código válido inexistente, indistinguibles / 404 |
| `HOST_CANNOT_PARTICIPATE` | Host intenta jugar en su sala / 403 |
| `SESSION_NOT_JOINABLE` | Primer join después del inicio / 409 |
| `SESSION_FINISHED` | Primer join en FINISHED o control ya finalizado / 409 |
| `ALREADY_IN_ACTIVE_SESSION` | Nueva incorporación a otra sala activa / 409 |
| `HOST_REQUIRED` | Control del host enviado por jugador / 403 |
| `INTERNAL_ERROR` | Fallo inesperado saneado, sin SQL/stack/secretos / 500 |

## Reconexión por identidad

1. Renovar el JWT con Supabase si corresponde; debe ser **la misma cuenta**.
2. Conectar namespace `/sessions`, path `/socket.io`, `auth: { token }`.
3. Jugador: `room:join { code }`; host: `room:subscribe { sessionId }`. Solo se suscribe ese socket.
4. GET por código da snapshot, pero no reemplaza la suscripción. El participante recuperado conserva
   id, joinedAt, respuestas y puntos confirmados en WAITING, IN_PROGRESS **y FINISHED**.
5. Un jugador nuevo solo entra en WAITING. Recuperar una sala terminada no modifica su reserva en
   otra sala activa. El host no se convierte en jugador.
6. Si se perdió un recibo, reenviar el mismo sessionQuestionId/choice con JWT vigente; el snapshot
   no agrega respuestas personales y otro choice no reemplaza la elección guardada.

Desconectar no equivale a leave ni pausa el reloj. Un cierre durante la ausencia puede aumentar
legítimamente el puntaje; recuperar no suma por sí mismo. FINISHED conserva resultados históricos,
también si sus puntos son distintos de 0/1/3.

## Runbook de reinicio de una instancia

**Guía para intervención posterior autorizada; no constancia de despliegue en VPS.**

1. Confirmar entorno, respaldo, BD y mecanismo de parada/arranque. Mantener una sola instancia;
   no cluster ni varias réplicas. No ejecutar sobre VPS/Supabase por correr pruebas locales.
2. Detener con el mecanismo del entorno. El cierre controlado drena módulos y cierra sockets/BD;
   al final cierra telemetría, sin process.exit anticipado del exportador.
3. Arrancar con la **misma BD**, sin recrear participantes ni borrar partidas. No hay migración nueva
   en este cambio. No aplicar futuras migraciones sobre partidas activas sin sus preflights.
4. El worker recupera deadlines antes de admitir tráfico: conserva plazos vigentes; cierra lo vencido
   con plazo efectivo y puntúa una vez. Respeta revisión restante o abre como máximo la siguiente
   pregunta con tiempo completo, sin consumir preguntas nunca mostradas ni reproducir soluciones omitidas.
5. Clientes autentican y resuscriben. streamId cambia: reemplazar el anterior, no comparar sequence
   entre streams ni aceptar paquetes de conexiones viejas. No hay replay durable/exactly-once.
6. Contrastar participantId/joinedAt, respuestas únicas y puntos antes/después, con dos salas y una
   cuenta ajena sin acceso. Registrar fecha, entorno y evidencia real.

La prueba local crea procesos distintos con la misma BD. No demuestra reinicio del VPS ni pérdida
abrupta de energía. No hay pausa o compensación de reloj. Rollback de código conserva datos: clientes
deben tolerar la ruta ausente y el antiguo rechazo de join FINISHED usando consulta por id/subscribe.

## Métricas y futura conexión a Grafana

Se reutiliza OTLP HTTP: `OTEL_EXPORTER_OTLP_ENDPOINT` habilita `<endpoint>/v1/metrics` y
`<endpoint>/v1/traces`. Sin endpoint la API no exporta. No se agrega /metrics público, otro servidor
Prometheus ni cuenta/dashboard. Las pruebas usan receptores/exportadores controlados locales.

| Instrumento | Tipo/unidad | Atributos y alcance |
|---|---|---|
| `profelink.game.commands` | Counter `{command}` | command/outcome/code, comando WS con callback al preparar ack |
| `profelink.game.command.duration` | Histogram `s` | mismos atributos; recepción a ack preparado, no RTT cliente |
| `profelink.game.answers` | Counter `{submission}` | outcome accepted/replayed/rejected/error y code; llamadas al servicio |
| `profelink.game.recovery.requests` | Counter `{request}` | operation state_by_code/room_join/room_subscribe; outcome created/recovered/rejected/error; code |
| `profelink.game.queue.wait` | Histogram `s` | espera del turno local, sin identidades |
| `profelink.game.deadline.lag` | Histogram `s` | kind ANSWER/REVIEW, trabajo efectivo; no cuenta no-ops |
| `profelink.game.notification.failures` | Counter `{failure}` | stage projection/delivery, una vez por intento fallido |
| `profelink.game.connections` | ObservableGauge `{connection}` | sockets autenticados conectados, incluidos no suscritos; no usuarios únicos |

commands usa nombres del catálogo o unsupported, success/rejected/error y código del catálogo o
NONE/EVENT_NOT_SUPPORTED. Datos arbitrarios nunca forman etiquetas. Alta inicial de join es created;
consulta autorizada o subscribe es recovered incluso si es la primera lectura de un host: no mide
reconexiones físicas únicas. El join REST no integra este contador específico de tres operaciones.

Accepted se registra tras commit; replayed no suma accepted, rollback no inventa aceptación y un
reintento SQL interno no multiplica la invocación. Fallos de entrega se separan sin deshacer puntos.
Son métricas de proceso best effort: reinician y pueden perderse al caer entre commit/exportación;
no son auditoría durable. Comando/cola usan reloj monotónico; deadline.lag usa el reloj autoritativo.

No se etiquetan tokens, email, payloads, elecciones, solución, SQL ni ids/códigos de sala/usuario/socket.
Se deshabilitan HTTP/Express/PG y FS automáticos en `src/telemetry-privacy.ts` para no exportar rutas,
cabeceras o SQL sin sanear. No se promete conservar las trazas HTTP/PG automáticas anteriores;
rehabilitarlas exige redacción verificada. Las métricas de juego siguen disponibles con etiquetas acotadas.

Después de crear tu cuenta/destino, conectar el receptor OTLP compatible y verificar los nombres/unidades
que Grafana recibe. Preparar vistas de tasa por comando/resultado, accepted frente a replayed,
recuperaciones/rechazos, p95/p99, retraso de deadlines y conexiones. Nombres Prometheus/buckets dependen
del exportador; todavía no se afirma validado un panel ni una consulta visual.

## Demostración local reproducible

Con Docker y TEST_DATABASE_URL local de pruebas disponibles:

```powershell
npm run demo:sessions -- --levels=4,8 --seconds=3 --ack-timeout-ms=10000 --p95-ms=1000 --p99-ms=2000
npm run test:sockets -- --testPathPatterns process-restart --detectOpenHandles
```

Todos los parámetros de demo son explícitos: hasta cuatro niveles pares ascendentes de 4–64 jugadores,
ventana de 1–60s, timeout 500–30000ms, presupuestos p95 <= p99 <= timeout. Son criterios del ensayo,
**no SLA**. Se rechaza una BD no loopback o coincidente con desarrollo antes de crear recursos.

Cada nivel crea esquema propio, aplica migraciones sin partidas y levanta un hijo con JWT locales y
Storage simulado. Dos hosts y un socket adicional de una cuenta permiten probar duplicados: 4 jugadores
son 7 sockets y 8 son 11 sockets. No son dispositivos físicos. Se limpia solo el esquema/procesos propios.

Warmup se separa de la ventana de carga. Se muestrean conexiones autenticadas reales en servidor,
mientras varios clientes suscriben; se verifican también respuesta válida/duplicada/tardía, cambio de
elección, permisos, aislamiento, recuperación y resultados. Se separan rechazos esperados de fallos.
Percentiles del reporte son RTT cliente de ack durante carga, no command.duration interno.

JSON y Markdown se guardan con nombre único en `reports/sessions/`, sin sobrescribir evidencia anterior.
highestPassedLevel solo usa niveles ejecutados que mantuvieron concurrencia observada y cumplieron
duración, presupuestos e integridad; de otro modo null. Se detiene al fallar. CPU/uso de BD no medidos
se declaran no disponibles. No extrapolar un ensayo corto local a producción, VPS o servicios remotos reales.

## Guía de dispositivos físicos — pendiente

1. Usar frontend/clientes Socket.IO de prueba disponibles, dos hosts y cuentas distintas. No compartir
   ni publicar JWT/service-role. Contar dispositivos, cuentas y sockets por separado; pestañas no son dispositivos.
2. Crear dos salas con tiempos distintos, entrar por código e iniciar como host. Comprobar que un
   jugador no controla la sala. Enviar respuesta válida/duplicada/tardía y a sala ajena, con recibo privado.
3. Tras un cierre registrar identidad/puntaje, desconectar y recuperar con JWT de la misma cuenta.
   Mostrar mismo participante y acumulado confirmado sin nueva fila. Comprobar aislamiento de los cinco eventos.
4. Solo si se autoriza reinicio del entorno, seguir el runbook con la misma BD y repetir. Adjuntar
   fecha, entorno, dispositivos/conexiones reales, criterios, mediciones y fallos; no etiquetar métricas con ids.
5. No acreditar dispositivos físicos, VPS o Grafana mediante el harness simulado.

| Verificación externa | Estado | Evidencia necesaria |
|---|---|---|
| Varios dispositivos físicos | Pendiente | Fecha, dispositivos/cuentas, dos salas, reconexión sin duplicados |
| Reinicio VPS | Pendiente de autorización | Entorno/proceso/BD y datos antes/después |
| Cuenta/conexión Grafana | Diferido por el usuario | Recepción y configuración de métricas verificadas |
| Dashboards/validación visual | Pendiente | Consultas/capturas con nombres/unidades realmente observados |
