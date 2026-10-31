## 1. Contratos y preparación

- [x] 1.1 Agregar versiones compatibles de `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io` y `socket.io-client` de pruebas, actualizando el lockfile sin cambiar dependencias ajenas.
- [x] 1.2 Definir tipos de comandos, DTOs estrictos, `RoomEnvelope`, nombres de eventos y unión de acks de acuerdo con ambas specs; mantener `SessionState` REST sin campos adicionales.
- [x] 1.3 Preparar un harness de clientes Socket.IO reales y puerto efímero con PostgreSQL exclusivo mediante `TEST_DATABASE_URL`, esquemas aislados, fixtures JWT/JWKS controlados y cierre completo de recursos.

## 2. Autenticación y renovación

- [x] 2.1 Reutilizar la verificación de `AuthService` para obtener identidad y vencimiento verificados sin cambiar su API REST; probar firma, issuer, audience, algoritmo, UUID y `exp` requerido para sockets.
- [x] 2.2 Implementar middleware de handshake con `handshake.auth.token`, rechazo `connect_error.data` uniforme y exclusión de credenciales por query string.
- [x] 2.3 Adaptar el guard global a contextos de transporte y aplicar autenticación explícita en comandos del Gateway, manteniendo intacta la protección HTTP.
- [x] 2.4 Implementar desconexión por vencimiento, exclusión de receptores vencidos antes de enviar y limpieza de timers en disconnect/shutdown, sin cambiar participación del dominio.
- [x] 2.5 Implementar `auth:refresh` para la misma cuenta con token actual vigente, sustitución atómica y generación de timer; rechazar identidad diferente, token inválido o renovación tardía sin ampliar el token anterior.
- [x] 2.6 Probar renovación sin pérdida de suscripción, timer viejo inocuo, dos renovaciones concurrentes, vencimiento durante validación y socket inactivo vencido que no recibe broadcasts.

## 3. Cambios confirmados y coordinación por sala

- [x] 3.1 Incorporar un coordinador por `sessionId` compartido por servicios, plazos y suscripciones; mantener independencia entre salas y los bloqueos/orden sala-perfil de PostgreSQL.
- [x] 3.2 Capturar resultados inmutables de cambios y snapshots dentro de la transacción; publicar solo después del commit y descartar notificaciones en rollback, sin otro bloqueo de sala anidado.
- [x] 3.3 Integrar creación/incorporación/salida con el coordinador, resolver join por código y revalidarlo transaccionalmente; distinguir cambios efectivos de rejoin/salida idempotentes y conservar respuestas REST.
- [x] 3.4 Integrar inicio/avance/finalización, evaluación interna de respuestas y `processDeadline` con el mismo flujo; permitir que el adaptador obtenga el resultado confirmado sin releer otra transición desde el Gateway.
- [x] 3.5 Implementar un puerto de notificaciones independiente de Socket.IO y su publicador, con secuencia por cambio y streamId por generación; evitar dependencias circulares y eventos para no-ops.
- [x] 3.6 Probar rollback, plazo obsoleto, rejoin idempotente y fallo de publicación posterior al commit: sin eventos falsos, duplicación de mutaciones ni pérdida de capacidad para consultar estado.

## 4. Suscripciones y múltiples dispositivos

- [x] 4.1 Implementar namespace `/sessions`, path `/socket.io` e índice privado de sockets por usuario/sala; agregar rooms solo después de autorización del dominio.
- [x] 4.2 Implementar `room:join` por código normalizado con ack `{ participant, room }`, misma incorporación que REST y suscripción solo del socket solicitante.
- [x] 4.3 Implementar `room:subscribe` por `sessionId` para host y participantes, incluyendo historial, bajo la coordinación de sala para lectura inicial y activación sin perder cambios concurrentes.
- [x] 4.4 Implementar `room:leave` y revocación de todos los sockets de la identidad tras salida confirmada por WebSocket o REST, sin retirarlos de otras salas autorizadas.
- [x] 4.5 Limpiar solo índices y timers de un socket al desconectar; mantener participante/reserva y otros dispositivos conectados, sin emitir falsa baja de jugador.
- [x] 4.6 Probar dos dispositivos con mismo participante, suscripción ajena/inexistente rechazada, rejoin en curso, restricciones de host/exclusividad y suscripción autorizada a sala finalizada.
- [x] 4.7 Probar carrera suscripción/salida REST, carrera suscripción/transición, salida de todos los dispositivos y ausencia de revocación o broadcasts en salas no afectadas.

## 5. Comandos y acknowledgments

- [x] 5.1 Implementar despacho estricto de `game:start`, `game:advance` y `game:finish` hacia el dominio, con actor del JWT y estado confirmado en el ack, sin suscribir implícitamente al emisor.
- [x] 5.2 Unificar errores de autenticación, validación, dominio e inesperados en un único ack, incluyendo fallos anteriores al handler; no usar `exception` como respuesta alternativa.
- [x] 5.3 Rechazar ejecución sin callback y responder `EVENT_NOT_SUPPORTED` a nombres desconocidos con callback, incluido `answer:submit`, sin agregar aceptación de respuestas ni `answer:ack`.
- [x] 5.4 Probar que participante y host de otra sala no pueden iniciar/avanzar/finalizar; probar además un host autorizado sin suscripción previa y dos inicios simultáneos con una sola apertura.
- [x] 5.5 Probar UUID/código inválido, cuerpos no objeto, campos de suplantación/extra, errores internos sin secretos, ack único y mensajes sin callback sin efectos.
- [x] 5.6 Probar avance abierto/prematuro/obsoleto y finalización en espera/respuesta/revisión, sin reiniciar FINISHED ni saltar preguntas; comprobar ausencia de inserción de Answer por comandos públicos.

## 6. Proyección segura y reloj

- [x] 6.1 Implementar proyección WebSocket con lista blanca basada en el proyector existente, sin entidades ni claves internas; firmar una sola imagen por envelope compartido y preservar REST/OpenAPI.
- [x] 6.2 Calcular `remainingMs` y ambos `serverTime` con una muestra de reloj posterior a la firma, usando el deadline persistido y cero fuera de ANSWERING; probar límite exacto y firma lenta sin ampliar tiempo.
- [x] 6.3 Implementar entrega ordenada de `room:state` y evento específico del mismo cambio con stream/secuencia comunes; reconexión devuelve estado actual sin recuperación automática de rooms ni replay.
- [x] 6.4 Probar igualdad de pregunta, imagen y deadline en dos dispositivos; verificar ausencia recursiva de `correctBoolean`, futuras preguntas y respuestas en todos los eventos y acks de pregunta abierta, también para el host.
- [x] 6.5 Probar revisión de cinco segundos con solución, siguiente apertura sin solución, finalización anticipada y recuperación atrasada sin publicación de revisiones históricas.
- [x] 6.6 Probar snapshot con ediciones de título, orden, texto, solución e imagen antes del inicio y durante el juego, eliminación del quiz y reconexión; comprobar que se firma la clave copiada, no la referencia nueva.
- [x] 6.7 Probar secuencias con firma lenta, consulta sin cambio, ack inicial concurrente, stream nuevo tras reinicio/recreación y recuperación de plazos con cliente reconectado.
- [x] 6.8 Acotar fallos/esperas de firma y probar que no filtran entidades, no revierten commits ni bloquean otras salas; documentar recuperación por consulta cuando un ack de estado no puede proyectarse.

## 7. Broadcasts, configuración y operación

- [x] 7.1 Conectar cambios REST, worker y evaluación interna al publicador común; notificar aperturas, revisión y finalización sin depender del host conectado.
- [x] 7.2 Probar dos salas con host/jugadores/dispositivos distintos y recoger todos los eventos: ningún broadcast cruza `sessionId`, aun con comandos ajenos, plazos simultáneos y finalizaciones concurrentes.
- [x] 7.3 Aplicar `CORS_ORIGIN` y control de admisión de Origin a polling y WebSocket; probar origen permitido/prohibido y cliente sin Origin con y sin JWT.
- [x] 7.4 Coordinar inicio/apagado de publicador, sockets, colas y worker; probar cierre sin handles abiertos y persistencia de participantes, snapshots y deadlines tras reiniciar.
- [x] 7.5 Documentar el contrato de eventos/acks con ejemplos, distinción path/namespace, renovación/reconnect del cliente y secuencias; dejar explícito que respuestas/puntuación siguen fuera de alcance.
- [x] 7.6 Documentar una instancia en VPS, múltiples salas, TLS/proxy upgrade/polling y heartbeat; señalar límites sin Redis/replay durable, TTL de JWT externo, snapshot en creación y retención física de imágenes no garantizada.

## 8. Verificación final y regresión

- [x] 8.1 Ejecutar build, unitarias y lint sobre archivos afectados, preservando cambios previos y sin relajar nuevas reglas para ocultar errores; registrar resultados reales y advertencias.
- [x] 8.2 Ejecutar nuevas pruebas de sockets y suites de sesiones/integración/e2e únicamente contra BD de pruebas, sin fallback a desarrollo/Supabase y sin declarar pruebas omitidas como aprobadas.
- [x] 8.3 Revisar cobertura de cada escenario de ambas specs, schemas REST sin cambios y compatibilidad de los comandos internos; comprobar ausencia de conexiones/timers abiertos y validar el cambio OpenSpec antes del handoff.

## 9. Resultados de verificación (2026-10-29)

| Verificación | Resultado real |
|---|---|
| `npm run build` | Aprobado |
| `npm test -- --runInBand` | 145 pruebas, 21 suites aprobadas |
| `npm run test:sockets -- --detectOpenHandles` | 40 pruebas, 2 suites aprobadas; sin reporte de handles abiertos |
| `npm run test:sessions` | 46 pruebas, 5 suites aprobadas |
| `npm run test:integration` | 5 pruebas aprobadas |
| `npm run test:e2e` | 1 prueba aprobada |
| ESLint explícito sobre archivos afectados de este cambio | 0 errores y 0 advertencias; no se relajaron reglas |
| `openspec validate add-session-socket-gateway-and-safe-questions --strict` | Válido |
| `git diff --check` | Sin errores de whitespace; Git advierte normalización LF/CRLF |

Cobertura revisada: `test/sockets/sessions.sockets-spec.ts` cubre permisos, cuerpos/acks, aislamiento,
multidispositivo, salidas y carreras, rollback/no-op, snapshot antes y después del inicio, proyección
abierta/revisión/finalización y reloj. `test/sockets/auth-and-recovery.sockets-spec.ts` cubre renovación
sin cortes, expiración, Origin en ambos transportes, carrera REST/suscripción, fallo de imagen y
recuperación del registro de streams/worker conservando PostgreSQL. Las pruebas unitarias de auth,
dispatcher y notificaciones cubren claims, renovaciones concurrentes, timers anteriores, vencimiento
durante validación/comando, timeout con abort y coordinación independiente entre salas.

Las suites usan PostgreSQL local de pruebas, JWT/JWKS locales y Storage simulado. La recuperación de
la nueva suite se ejercita reemplazando el estado volátil del stream y el worker con BD conservada;
no equivale a una prueba de despliegue/reinicio real del VPS. La aceptación de dos dispositivos se
verifica con clientes Socket.IO reales y payloads/deadlines iguales, no con una UI implementada.

Los mensajes ERROR de algunas pruebas son fallos inyectados deliberadamente para comprobar rollback,
normalización y recuperación. Hubo timeouts transitorios y un import de prueba incompatible con Jest
durante desarrollo; se corrigió el import, se ajustó el margen de los JWT cortos de prueba y se ejecutó
después la suite completa sin omisiones. La instalación npm reportó 12 vulnerabilidades de dependencias
(8 bajas, 2 moderadas, 2 altas); no se ejecutó `npm audit fix` ni cambios de versiones ajenos al alcance.
No se modificó Supabase productivo, no se desplegó el VPS y no se hizo commit ni push.
