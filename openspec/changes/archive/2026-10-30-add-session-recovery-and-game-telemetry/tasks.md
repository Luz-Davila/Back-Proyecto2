## 1. Contratos de recuperación y autorización compartida

- [x] 1.1 Definir DTO/normalización estricta del código para GET /sessions/:code/state y probar espacios, minúsculas, alfabeto/longitud inválidos y precedencia de autenticación.
- [x] 1.2 Exponer lookup por código y política compartida de acceso host/participante sobre snapshot coherente, sin alta implícita, caché de identidad, locks anidados ni consulta del quiz original.
- [x] 1.3 Implementar lectura ordenada por código con la proyección/envelope existentes, timeout de firma, secuencia sin incremento, sin ejecutar transiciones ni crear suscripciones HTTP.
- [x] 1.4 Agregar ruta y OpenAPI de RoomEnvelope de ocho campos, Cache-Control private/no-store y errores REST existentes; mantener rutas y shapes previos por id y join.

## 2. Recuperación idempotente de participación finalizada

- [x] 2.1 Reordenar join bajo el lock existente: host propio, participante persistido, y solo si falta validar FINISHED/IN_PROGRESS/WAITING y aplicar el alta/reserva habitual.
- [x] 2.2 Recuperar id/joinedAt/respuestas/resultados en FINISHED sin perfil nuevo, reserva, suma o secuencia extra; preservar reserva que el usuario tenga en otra sala activa.
- [x] 2.3 Mantener room:join autenticado con payload/ack exactos y suscripción solo al emisor, sin mover reglas al Gateway ni añadir respuestas personales al envelope.
- [x] 2.4 Adaptar regresiones del contrato FINISHED conservando casos de primer join tardío/finalizado, host, suplantación, exclusividad activa y salida concurrente.

## 3. Aceptación REST y Socket.IO de la recuperación

- [x] 3.1 Probar GET por código en WAITING/ANSWERING/REVIEW/FINISHED para host/participante, incluyendo resultados heredados y no filtración OPEN; verificar error indistinguible para ajeno/inexistente y ausencia de mutaciones.
- [x] 3.2 Probar claves exactas y compatibilidad entre envelope HTTP y WS sin exigir igualdad de firmas/serverTime entre lecturas; conservar SessionState de GET por id y schema OpenAPI anterior.
- [x] 3.3 Probar recuperación multidispositivo con mismo participantId/joinedAt, puntaje confirmado, Answer.id/answeredAt y conteos; sin reservas/respuestas/eventos/secuencia adicionales.
- [x] 3.4 Probar lectura/salida/cierre/avance concurrentes, consulta OPEN vencida sin worker, fallo de firma y cola lenta, sin ampliar deadlines ni retener acceso no autorizado.

## 4. Fachada y ciclo de vida de telemetría

- [x] 4.1 Crear catálogo tipado y fachada inyectable para los ocho instrumentos del diseño, con unidades/atributos acotados y funcionamiento no-op sin exportación.
- [x] 4.2 Reutilizar el SDK/OTLP existente y preparar proveedor/exportador local controlado para pruebas; no crear SDKs por sala ni requerir Collector o cuenta de Grafana.
- [x] 4.3 Proteger el juego de errores/exportación lenta y coordinar cierre de SDK/aplicación, callbacks y señales sin process.exit prematuro ni listeners duplicados.
- [x] 4.4 Revisar configuración de auto-instrumentación HTTP/PG y probar que métricas de juego no contienen tokens, identidades, códigos de sala, rutas concretas, SQL, choices ni mensajes arbitrarios.

## 5. Instrumentación en límites únicos

- [x] 5.1 Observar comandos WS y command.duration una vez al preparar ack, incluidos errores previos al dispatcher; normalizar eventos desconocidos y excluir mensajes sin callback/handshakes rechazados.
- [x] 5.2 Distinguir accepted/replayed/rejected/error del servicio de respuestas mediante metadatos internos y registrar después de commit sin cambiar AnswerReceipt ni duplicar por reintento SQL.
- [x] 5.3 Instrumentar recuperación de GET por código antes de guards y al finalizar respuesta, más room:join/subscribe, distinguiendo created/recovered/rejected/error sin observar dos veces el servicio compartido.
- [x] 5.4 Medir queue.wait con fuente monotónica en el coordinador y deadline.lag con el instante autoritativo del trabajo efectivo, publicando solo tras commit y excluyendo plazos obsoletos.
- [x] 5.5 Observar fallos de publicación por etapa projection/delivery una sola vez y mantener la recuperación posterior al commit, sin clasificar consultas como broadcasts fallidos.
- [x] 5.6 Implementar gauge de sockets autenticados conectados, incluidos no suscritos; cubrir renovación, expiración, dos dispositivos, desconexión y destrucción sin retener sockets.

## 6. Pruebas de métricas y fallos

- [x] 6.1 Verificar contador/duración por comando con éxito, dominio, validación, auth y evento arbitrario, sin modificar el ack ni crear nuevas series por texto recibido.
- [x] 6.2 Verificar una respuesta nueva y dos reintentos como un accepted/dos replayed; comprobar rollback y colisión única real sin accepted ficticio ni doble conteo interno.
- [x] 6.3 Verificar alta inicial frente a recuperación, rechazos HTTP previos al servicio y recuperación FINISHED; comprobar resultados de métricas sin nuevos registros de dominio.
- [x] 6.4 Probar cola/proyección lenta, retraso de deadline efectivo, repetición no-op y fallo posterior al commit con valores/etapas y cardinalidad esperados.
- [x] 6.5 Probar misma secuencia de juego sin telemetría y con exportador que falla/se demora; verificar cierre de recursos con detección de handles abiertos.

## 7. Harness aislado y reinicio real local

- [x] 7.1 Crear soporte padre/hijo de backend local con TEST_DATABASE_URL de loopback exclusiva, esquema aleatorio, JWT locales y Storage simulado; bloquear fallback y destino arbitrario/producción antes de iniciar.
- [x] 7.2 Aplicar migraciones/fixtures solo al preparar el esquema, arrancar hijo con señal de listo/puerto y reutilizar la misma BD/clave pública al reiniciar, sin nuevas migraciones sobre partidas activas.
- [x] 7.3 Probar parada/arranque real del proceso en ANSWERING antes y después del deadline, conservando pregunta/plazo o recuperando cierre/avance correctos y stream nuevo.
- [x] 7.4 Probar parada/arranque en REVIEW antes y después del deadline, con puntajes ya adjudicados, sin repuntuación, replay histórico ni salto de preguntas no mostradas.
- [x] 7.5 Verificar reconexión por código/join con la misma identidad y reserva, más otra cuenta/sala sin acceso; cerrar sockets/hijos/lectores y limpiar únicamente esquema propio incluso con fallo/timeout/señal.

## 8. Ejecutable multiusuario y evidencia medible

- [x] 8.1 Agregar demo:sessions local con niveles/duración/timeout/presupuestos explícitos y acotados, warmup separado y validación antes de crear recursos; no lanzar carga ilimitada ni contra endpoints remotos por defecto.
- [x] 8.2 Ejecutar escenario de dos salas con al menos dos jugadores diferentes por sala, tiempos distintos, respuesta válida/duplicada/tardía, controles sin permiso, cierres y recuperación; comprobar invariantes persistidos y aislamiento de todos los eventos.
- [x] 8.3 Medir jugadores únicos y sockets simultáneos reales/objetivo durante cada nivel, conteos, rechazos esperados, fallos inesperados y latencias cliente de ack p50/p95/p99 separadas de tiempos internos.
- [x] 8.4 Generar reporte JSON y Markdown con entorno/revisión/dirty/dependencias simuladas/parámetros/criterios y niveles aprobados/fallidos; usar highestPassedLevel null si ninguno cumple y declarar mediciones ausentes sin inventarlas.
- [x] 8.5 Probar el generador/evaluador con niveles aprobados, fallidos, no alcanzados, datos ausentes y timeout, sin confundir conexiones solicitadas con concurrencia mantenida.
- [x] 8.6 Ejecutar un ensayo local pequeño real durante apply y guardar su reporte con configuración, recursos/límites y mayor nivel observado aprobado, sin presentarlo como máximo productivo ni prueba de dispositivos físicos.

## 9. Documentación y comprobación final

- [x] 9.1 Actualizar README/OpenAPI y ejemplos P3/P4 con ruta por código, recuperación en FINISHED, payloads/acks/errores exactos y answer:ack como callback privado, sin alterar fórmula ni contratos anteriores.
- [x] 9.2 Documentar reinicio de una instancia y misma BD, JWT vigente, resuscripción/stream nuevo/deadlines, diferencias entre apagado controlado y caída abrupta, y rollback de código sin borrar datos.
- [x] 9.3 Entregar guía de varios dispositivos físicos/dos salas y runbook de VPS con autorización previa; crear registro externo explícitamente pendiente, separado de las tareas de implementación local.
- [x] 9.4 Documentar catálogo de métricas, privacidad, unidades, exportación opcional y preparación de conexión futura; dejar cuenta, dashboards y validación Grafana pendientes sin instalarlos ni exigirlos para pruebas locales.
- [x] 9.5 Ejecutar build, unitarias, lint/formato afectados, sesiones, sockets con detectOpenHandles, integración y e2e secuenciales donde comparten BD; registrar errores/timeouts reales sin ampliar presupuestos silenciosamente.
- [x] 9.6 Revisar escenarios de las cinco specs, reportar pruebas locales y diferidos por separado, validar OpenSpec estricto y preservar trabajo previo sin commit, push, despliegue ni archivado automático.

## Evidencia y límites de cierre

Ver [verification.md](verification.md): 359 pruebas aprobadas, build/typecheck/lint/formato
y validación estricta satisfactorios. Incluye matriz de escenarios, correcciones durante desarrollo
y reportes reales de demo local con 4/8 jugadores; mayor nivel observado aprobado: 8 jugadores y
11 sockets en dos salas durante una ventana de carga de unos tres segundos, no máximo productivo.

Grafana, dispositivos físicos y reinicio de VPS siguen pendientes externos según
`docs/session-recovery-and-telemetry.md`; cerrar estas 44 tareas implementables no los acredita.
