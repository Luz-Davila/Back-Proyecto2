## Context

Ver motivación y alcance en `proposal.md`. El cambio 5–6 ya está archivado y sincronizado; conserva el motor de una instancia y el contrato de ocho campos de RoomEnvelope.

- `SessionRoomsService.join` ya recupera por sessionId/userId en WAITING/IN_PROGRESS, pero verifica FINISHED antes de buscar participante. Su flujo es común a REST y Socket.IO.
- `SessionRoomsService.observe` serializa lectura y suscripción por sala; `SessionsRepository.read` obtiene un agregado con aislamiento REPEATABLE READ. Los códigos no se reutilizan.
- `SessionNotifications.current/envelope` proyecta un snapshot y posición compartidos, sin avanzar secuencia por consulta. La proyección incluye firma con límite de cinco segundos y ocupa la cola local.
- `SessionDeadlinesService` procesa plazos persistidos al arrancar y cada 250ms. El dominio ya resuelve atrasos sin consumir preguntas nunca mostradas; hay tests de worker/recreación de streams, no una demostración completa de proceso local nuevo.
- `src/telemetry.ts` inicializa OpenTelemetry antes de la aplicación, exporta OTLP si se configura endpoint y actualmente no tiene instrumentos del juego. Las dependencias de API, SDK y exportadores ya existen.
- `test/support/` ofrece PostgreSQL exclusivo, esquemas aislados, JWT locales y Storage simulado. La conexión de pruebas autorizada está en localhost:15433; no hay permiso para usar producción ni desplegar Grafana/VPS.

El diseño es necesario por sus cambios transversales de autorización, orden de publicación, semántica de métricas y pruebas entre procesos.

## Goals / Non-Goals

**Goals:**
- Compartir autorización/proyección entre recuperación HTTP y WS sin introducir una segunda máquina de estados.
- Distinguir pertenencia histórica de reserva activa y sockets conectados de jugadores únicos.
- Observar resultados finales de invocaciones y latencias útiles sin convertir métricas en lógica de juego ni contabilidad durable.
- Producir evidencia local repetible con criterios explícitos y distinguir lo no ejecutado.

**Non-Goals:**
- No agregar respuesta personal al snapshot ni cambiar AnswerReceipt; si el cliente conserva su payload, recupera el recibo mediante el reintento idempotente ya existente.
- No persistir stream/secuencia, distribuir colas ni simular entrega exactly-once.
- No eliminar la influencia de red/cola/firma sobre admisión/bonus; medirla no autoriza backdating.
- No introducir endpoint público de diagnóstico/carga, frontend, cuentas remotas ni gestión de Grafana.

## Decisions

### 1. Recuperación HTTP por código como lectura de aplicación

Agregar `GET /sessions/:code/state` con normalización y validación del alfabeto de seis caracteres usados por join. Debe convivir con `GET /sessions/:id`; probar explícitamente ambas rutas y sus schemas. Usar JWT/errores existentes, sin nuevos códigos. Publicar el nuevo cuerpo como envelope completo y `Cache-Control: private, no-store` para no reutilizar snapshots autorizados entre identidades.

Resolver el id por código solo para enrutar y entrar una sola vez en el coordinador existente. Dentro, cargar un agregado coherente y revalidar host/participante antes de proyectar. Reutilizar la autorización de observe, o extraer una política común pequeña, sin llamar a join desde GET. No ejecutar worker ni transición de recuperación desde la lectura: una OPEN cuyo plazo venció puede devolver remainingMs 0 hasta que el worker confirme el cierre. No guardar entidades ni crear suscripción HTTP. Asignar una posición de stream en memoria a una primera lectura no es una transición ni incrementa sequence.

El nuevo endpoint puede devolver scoreboard y revisión porque esos datos están fuera de `state`. Actualizar el texto y schema correspondiente para que la restricción REST anterior se entienda sobre `GET /sessions/:id`, no como prohibición del nuevo envelope HTTP. Usar la misma firma/proyección acotada que WS; ante un fallo devolver INTERNAL_ERROR saneado, sin cambios en BD.

**Alternativas:** devolver solo SessionState impide recuperar el acumulado parcial; añadir campos al estado por id rompe lectores anteriores; usar join para consultar causa mutaciones; permitir consulta por código sin pertenencia filtra partidas.

### 2. Recuperar miembro antes de validar nueva incorporación

Dentro del mismo `repository.locked` de join:
1. Mantener primero el rechazo al host propio.
2. Buscar el participante persistido de la identidad autenticada.
3. Si existe, devolverlo y proyectar la sala en cualquier estado, sin perfil nuevo, insert, reserva o comprobación de exclusividad para unirse de nuevo.
4. Si no existe, mantener FINISHED → SESSION_FINISHED, IN_PROGRESS → SESSION_NOT_JOINABLE, y el flujo vigente de perfil/reserva/alta en WAITING.

Esta ordenación permite recuperar historia aunque el jugador ya esté reservado en otra sala activa. No aplicar a la recuperación histórica ninguna liberación o reconstrucción de la reserva. Mantener las restricciones únicas, locks y la política de salida existentes.

El comportamiento se aplica coherentemente a POST /sessions/join y room:join porque comparten servicio. Cambia el resultado de FINISHED para participantes existentes, no los shapes: REST `{ participant, session }`, WS `{ ok: true, data: { participant, room } }`. Suscribir solo al socket que pidió join después de autorizarlo, bajo el flujo ordenado actual. No aumentar secuencia/broadcast por recuperación sin cambio; una transición concurrente sí puede cambiar el acumulado legítimamente.

**Alternativas:** relajar FINISHED solo en el Gateway duplica reglas y contradice al servicio; recrear participante invalida sus respuestas/resultados; usar caché de sockets pierde recuperación tras reiniciar.

### 3. Semántica de reinicio: conservar datos, recrear transporte

No cambiar políticas de deadlines ni la fórmula 0/1/3. El proceso nuevo carga la misma BD, inicia el worker antes de admitir tráfico y genera streams nuevos. Si el plazo sigue vigente, conserva closesAt/reviewEndsAt; si venció, procesa el cierre/avance permitido y abre como máximo la siguiente pregunta con su tiempo completo. No pausar el reloj por desconexión, reproducir soluciones omitidas ni contar desde cero la pregunta anterior.

El cliente vuelve a autenticar con un JWT vigente de la misma cuenta y realiza room:join para jugador o room:subscribe para host. GET por código da un snapshot pero no reemplaza la suscripción. Debe reemplazar la referencia al stream anterior, no comparar secuencias entre streams y no aplicar respuestas de conexiones antiguas. Un cierre ocurrido durante su ausencia puede elevar legítimamente su puntaje; comprobar que sigue al mismo participante y que el incremento es solo el adjudicado.

La prueba automatizada reinicia un proceso real local, no solo un servicio. Cubrir ANSWERING antes/después de closesAt y REVIEW antes/después de reviewEndsAt. Es una parada/reanudación controlada; una prueba de caída abrupta, si se añade posteriormente, debe identificarse aparte. La demo en VPS permanece fuera de ejecución hasta autorización.

**Alternativas:** pausar al reiniciar favorece indisponibilidad y cambia reglas; guardar sockets/stream en BD agrega replay y migración no requeridos; afirmar que un mock de worker prueba un VPS no es evidencia suficiente.

### 4. Fachada de métricas con exportación opcional

Crear una fachada inyectable de métricas del juego sobre el Meter global de OpenTelemetry y conservar el arranque temprano de `src/telemetry.ts`. No inicializar un SDK por sala ni por prueba. En pruebas, inyectar un MeterProvider/exportador controlado y cerrar sus lectores; sin endpoint externo, los instrumentos son no-op para la aplicación. No agregar un segundo servidor Prometheus ni /metrics público en este alcance.

La fachada recibe únicamente categorías del catálogo, captura fallos propios sin lanzar errores de negocio y no espera red/exportación en una transacción ni al preparar ack. Usar API ya instalada; no aumentar dependencias de infraestructura sin necesidad. Los tests de instrumentos son independientes de una cuenta, Collector remoto o Grafana. Coordinar el cierre del SDK con el de la aplicación para no terminar el proceso antes de drenar trabajo y liberar sockets/BD; no acumular handlers SIGTERM/SIGINT al recrear el entorno de pruebas.

| Instrumento | Tipo / unidad | Atributos permitidos y semántica |
|---|---|---|
| `profelink.game.commands` | Counter / `{command}` | `command`, `outcome`, `code`: una observación por comando WS con callback al preparar su ack final |
| `profelink.game.command.duration` | Histogram / `s` | Mismos atributos; duración monotónica de recepción a preparación del ack, no RTT cliente |
| `profelink.game.answers` | Counter / `{submission}` | `outcome=accepted|replayed|rejected|error`, `code`; invocación al servicio, no paquetes rechazados antes por transporte |
| `profelink.game.recovery.requests` | Counter / `{request}` | `operation=state_by_code|room_join|room_subscribe`, `outcome=created|recovered|rejected|error`, `code`; created solo para alta inicial de join |
| `profelink.game.queue.wait` | Histogram / `s` | Sin ids ni etiquetas de operación inventadas; espera local hasta obtener turno de sala |
| `profelink.game.deadline.lag` | Histogram / `s` | `kind=ANSWER|REVIEW`; retraso del trabajo que efectivamente transicionó, no del cierre efectivo retroactivo |
| `profelink.game.notification.failures` | Counter / `{failure}` | `stage=projection|delivery`; un fallo por intento de publicación, sin duplicar el catch de proyección y el del sink |
| `profelink.game.connections` | ObservableGauge / `{connection}` | Sin etiquetas; sockets autenticados aún conectados de esta instancia, incluidos no suscritos |

`command` usa SESSION_COMMANDS y `unsupported`; `outcome` de comandos usa success/rejected/error; `code` usa el catálogo de sesiones, EVENT_NOT_SUPPORTED o NONE. Texto desconocido no se convierte en etiqueta: mapear fallo inesperado a INTERNAL_ERROR. En recovery, autenticación/validación/autorización rechazadas se observan sin consultar/etiquetar identidad; una consulta por código o subscribe exitosa es recovered, aunque sea la primera lectura de un host. Documentar esa definición para no confundirla con conteo de reconexiones físicas.

Revisar la auto-instrumentación HTTP/PG existente: desactivar captura de SQL con valores y cabeceras sensibles y no etiquetar rutas concretas con códigos. Los instrumentos nuevos nunca reciben entidades completas o payloads. Limitar esta revisión al canal de telemetría; no alterar conexiones o lógica de consultas.

**Alternativas:** contadores en logs no permiten histogramas/gauges verificables; etiquetas por sala/usuario disparan cardinalidad y filtran datos; exportación síncrona introduce latencia y fallos de negocio; requerir Grafana ahora contradice el diferimiento acordado.

### 5. Medición en puntos únicos, después de decisiones reales

- **Comandos:** envolver el manejo de paquetes con callback en el adaptador con un observador técnico. La preparación de ack ya es única; terminar ahí observación/duración, incluidos errores previos al dispatcher. No registrar un éxito adicional en el dispatcher ni mover reglas al Gateway. Handshake rechazado o evento sin callback no es un comando procesado.
- **Respuestas:** conservar el retorno público AnswerReceipt. Internamente obtener disposición nueva/repetida sin añadirla al recibo, y observar accepted/replayed solo después de resolver la transacción. Reintentos internos por unique violation cuentan una sola vez; excepción final clasificada cuenta rejected/error. Inyectar fallo antes de commit debe dejar accepted en cero. Una interrupción del proceso entre commit y emisión puede perder una métrica: no se promete auditoría durable.
- **Recuperación:** observar una sola vez cada límite público listado, usando metadatos internos de alta/recuperación para join en vez de inferirlo del número de sockets. No registrar dos veces al compartir servicio REST/WS; el join REST conserva su contrato pero no pertenece a este contador específico, que documenta los tres accesos listados. Para GET por código usar un observador HTTP de esa ruta que empiece antes de guards y termine en finish/close de la respuesta, con una guarda de registro único; clasificar 200 como recovered y 400/401/404/500 por sus códigos saneados, sin etiquetar la URL. Así los rechazos de autenticación no quedan omitidos por ocurrir antes del servicio.
- **Cola:** tomar `performance.now()` antes y después de esperar la cola en SessionCoordinator. No usar SessionClock para duración y no incluir la ejecución dentro de la espera. Seguir liberando turno en finally.
- **Deadlines:** capturar instante de evaluación bajo la exclusión y comparar con expectedDeadline; publicar la observación después de commit solo si hubo transición. Mantener guardas por pregunta/plazo y excluir no-ops. Un job ANSWER que también salta una revisión ya pasada produce una observación ANSWER, no una REVIEW ficticia.
- **Notificaciones:** clasificar fallo de proyección o entrega con metadatos internos sin propagar texto sensible; contar una vez en el límite de publicación y mantener recuperación por suscripción. Una proyección fallida de una consulta es error de consulta, no fallo de broadcast.
- **Conexiones:** registrar socket una vez después del handshake aceptado y retirarlo en desconexión/cierre; el gauge filtra conectados con acceso vigente y no depende solo de las suscripciones del hub. No crear timers por métrica ni retener sockets cerrados.

**Alternativas:** observar solo el Gateway omite commits internos y confunde paquetes con altas; incrementar antes de guardar cuenta rollbacks; medir con Date.now o SessionClock confunde reloj de juego con latencia.

### 6. Harness local reproducible y reinicio entre procesos

Reutilizar entidades/módulos reales y guards; aislar Auth/Storage remotos con claves JWT locales y proveedor de imágenes de prueba, sin llamar Supabase. El ejecutor debe exigir TEST_DATABASE_URL de loopback, distinta de DATABASE_URL, antes de crear esquema/arrancar procesos. No heredar por defecto un OTLP endpoint remoto en el harness. El backend de demo usa reloj real para demostrar reinicio; las suites deterministas siguen usando reloj manual donde corresponde.

Un padre crea un esquema exclusivo aleatorio, aplica migraciones sin partidas y prepara fixtures. Inicia un proceso hijo de backend con el esquema y verificador JWT local, recibe señal de listo/puerto, y usa clientes Socket.IO/HTTP reales. Para reinicio, detiene solo ese hijo, conserva el esquema y arranca otro con los mismos datos/clave pública; los hijos no aplican migraciones nuevamente sobre juegos activos. El hijo no debe exponer endpoints diagnósticos de prueba en producción. La comunicación local controlada del harness puede confirmar disponibilidad y métricas; no manda tokens a reportes.

El padre verifica datos antes/después y limpia su esquema después de cerrar sockets/hijos/lectores. finally debe atender error, timeout y señales; si no logra limpiar, reportar el esquema exacto y causa, sin borrado amplio ni eliminación de datos ajenos. No matar procesos por puerto ni alterar servicios de red.

El escenario de reconexión compara mismos participantId/joinedAt, Answer.id/answeredAt y acumulados confirmados. Verificar con dos salas y otra cuenta que conocer código o tener socket anterior no da permiso. Para FINISHED incluir resultados heredados y reserva en otra sala.

**Alternativas:** mocks puros no comprueban transporte o procesos; tocar DATABASE_URL o iniciar contra un VPS aumenta riesgo; lanzar carga contra un destino arbitrario por defecto no es aceptable.

### 7. Carga acotada y reporte sin promesas de capacidad

Separar suites de corrección de un script explícito de demostración (`demo:sessions` como nombre previsto). El script recibe niveles de jugadores/sockets, duración, timeout de ack y presupuestos de latencia; valida límites antes de arrancar y registra parámetros efectivos. No fijar un SLA productivo. El caso mínimo usa dos salas con al menos dos jugadores diferentes por sala; niveles superiores son opt-in y acotados según recursos locales.

Medir conexiones simultáneas observadas en el servidor/harness, jugadores únicos y sockets por identidad. No confundir sockets solicitados con sockets realmente conectados, ni un pico breve con concurrencia mantenida durante el nivel. Mantener warmup separado y duración efectiva de carga en el reporte. Si no se alcanzó el nivel objetivo durante la ventana declarada, no aprobarlo.

Cada nivel verifica integridad y códigos esperados. Distinguir latencia cliente de ack (reloj monotónico del emisor, incluye ida/vuelta) de command.duration de servidor. Exportar JSON y resumen Markdown con entorno, versión/estado dirty, configuración, salas, jugadores, concurrencia objetivo/observada, duración, conteos, percentiles, invariantes y razones de aprobado/fallido. Un presupuesto incumplido, timeout inesperado, aislamiento roto, duplicado o nivel no alcanzado hace fallar el nivel. Datos no medidos como CPU/BD se declaran no disponibles; no completar con estimaciones.

El resumen usa `highestPassedLevel` solo si hubo un nivel observado y aprobado; de lo contrario null. Identificar el límite que detuvo el ensayo y conservar niveles fallidos. El resultado es el mayor nivel probado en ese hardware, con Auth/Storage simulados, nunca máximo de producción ni demo física. Durante apply se ejecuta un ensayo local pequeño y se registran sus datos reales; esta propuesta no genera resultados.

**Alternativas:** convertir el número de tests verdes en capacidad es incorrecto; usar conexiones máximas solicitadas exagera el resultado; carga ilimitada puede bloquear el equipo y no aporta una comparación reproducible.

### 8. Entrega documental y aceptación por etapas

Actualizar README y contrato OpenAPI, incluir payloads/acks/errores exactos y ejemplos P3/P4. Mantener explícito que answer:ack es callback y que snapshot no revela respuestas individuales. Añadir runbook de reinicio de una instancia con respaldo, conservación de BD, JWT vigente, nueva suscripción, streams y deadlines, sin ejecutar comandos sobre VPS por escribirlo.

Preparar guía de varios dispositivos reales, cuentas de prueba y dos salas. Su evidencia se llena solo al realizarla; documentación, cliente simulado y pestañas en una máquina no acreditan dispositivos físicos. La checklist externa tendrá estados pendientes separados del checklist implementable, para poder cerrar el software sin afirmar completado todo el paso 8.

Documentar OTLP actual, tipos/unidades/atributos y ejemplos de consultas/correspondencias futuras, sin instalar Collector, Prometheus o Grafana ni crear dashboards. Grafana, dispositivos físicos y VPS permanecen explícitamente pendientes. No incluir tareas de creación de cuenta o despliegue en esta implementación.

**Alternativas:** bloquear el backend por una cuenta aún no creada retrasa trabajo independiente; marcar un dashboard no visto como validado inventa aceptación; agregar frontend para la demo expande el alcance.

## Risks / Trade-offs

- [Join de FINISHED cambia comportamiento] → Marcar compatibilidad en propuesta/docs y adaptar regresiones sin retirar escenarios de acceso ajeno.
- [Métrica after-commit puede perderse al caer el proceso] → Declararla observabilidad best effort, no auditoría ni historial reconstruido.
- [Instrumentación duplica conteos entre capas] → Propietario único por instrumento, clasificaciones internas y pruebas con secuencias conocidas/rollback.
- [Auto-instrumentación captura datos sensibles] → Verificar configuración HTTP/PG y atributos exportados; nunca usar rutas completas/SQL/identidades como etiquetas de juego.
- [Firma/cola afecta recuperación y aceptación] → Mantener timeout y deadlines, medir demora, no compensar ni prometer SLA de tres segundos.
- [Pruebas reales son más lentas o inestables] → Barreras de listo, procesos/esquemas propios, presupuestos acotados y cierre en finally; registrar fallos, no ampliar timeouts silenciosamente.
- [Carga simulada se interpreta como demo real] → Reportar modalidad, hardware y dependencias simuladas, con checklist externo pendiente.
- [Estado de código sin commit] → Identificar revisión y dirty en reportes sin crear commit/push ni descartar trabajo anterior.

## Migration Plan

1. Implementar y verificar en BD local exclusiva; no se prevé migración de esquema ni recálculo de datos.
2. Ejecutar regresión existente y nuevas pruebas, reinicio real local, telemetría controlada y ensayo multiusuario acotado; registrar resultados y pendientes.
3. En un despliegue posterior autorizado, coordinar el contrato del nuevo endpoint y la recuperación FINISHED con clientes; conservar una sola instancia y la misma BD.
4. Para rollback de código, retirar endpoint/instrumentación y volver al comportamiento anterior; datos/puntos permanecen intactos. Los clientes deben tolerar ausencia del endpoint y la restricción anterior de join FINISHED usando subscribe/consulta por id donde corresponda. No reabrir ni borrar partidas.
5. Conectar Grafana y ejecutar demos externas solo cuando existan cuenta/entorno y autorización; anexar evidencia nueva sin atribuirla a las pruebas locales.
