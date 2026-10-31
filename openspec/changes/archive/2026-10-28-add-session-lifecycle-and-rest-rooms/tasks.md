## 1. Contratos de dominio y entorno de pruebas

- [x] 1.1 Definir los tipos de comandos, estados, fases y errores de dominio según ambos specs y el catálogo de `design.md`, sin incorporar eventos WebSocket ni fórmula de puntuación.
- [x] 1.2 Definir un reloj inyectable y construir fixtures de sala, host, participantes y preguntas que permitan probar 15/30 segundos y revisión de 5 segundos sin esperas reales.
- [x] 1.3 Preparar configuración y comando para pruebas de sesiones con `TEST_DATABASE_URL` obligatorio, sin fallback a la BD de desarrollo, y conexiones independientes para concurrencia.

## 2. Modelo y migración incremental

- [x] 2.1 Agregar duración de sala y tiempos `closedAt`/`reviewEndsAt` a las entidades, conservando los estados existentes y los índices únicos actuales.
- [x] 2.2 Definir entidad de reserva activa por `userId`, relación compuesta al participante e índices para consultas y liberación por sala.
- [x] 2.3 Escribir una migración nueva con restricciones de duración, tabla de reservas, RLS y backfill de salas en espera; incluir preflight que aborte ante partidas heredadas en curso, host jugador o participación activa incompatible, sin borrar datos.
- [x] 2.4 Verificar migración y reversión en BD de pruebas: base limpia, historial finalizado, reservas de espera y conflictos que deben abortar; comprobar conservación de las tablas previas.

## 3. Creación y participación transaccional

- [x] 3.1 Crear el módulo y repositorio de sesiones con contexto transaccional explícito, bloqueo de sala y orden sala/perfil para operaciones de jugadores; todas las consultas de un comando deben compartir conexión.
- [x] 3.2 Implementar creación desde cuestionario propio con instantánea consistente, copia de título/preguntas y duración requerida; comprobar que el host no se inserta como participante.
- [x] 3.3 Implementar códigos criptográficos de seis caracteres, hasta 10 reintentos seguros ante colisión y traducción a `ROOM_CODE_UNAVAILABLE` al agotar intentos.
- [x] 3.4 Implementar join por código normalizado y perfil autenticado, reserva global e idempotencia en la misma sala; devolver el participante existente antes de rechazar nuevos joins durante `IN_PROGRESS`.
- [x] 3.5 Implementar salida idempotente en `WAITING`, liberación de reserva y rechazo fuera de espera, manteniendo la lista de jugadores estable al iniciar.

## 4. Máquina de estados y finalización

- [x] 4.1 Implementar políticas de permisos y transiciones, con precedencia de errores, pruebas de comandos fuera de orden y estados terminales sin reinicio ni reapertura.
- [x] 4.2 Implementar inicio atómico de sala y primera pregunta, con mínimo de una pregunta y un jugador, tiempos persistidos y protección de inicio repetido.
- [x] 4.3 Implementar cierre por plazo y evaluación interna de todas las respuestas aceptadas, considerando solo participantes y pregunta de la misma sala y sin crear respuestas para omisiones.
- [x] 4.4 Implementar revisión de cinco segundos y avance protegido por pregunta esperada; bloquear avance prematuro y convertir temporizadores obsoletos en no-op.
- [x] 4.5 Implementar finalización normal y anticipada, conservación de preguntas pendientes y respuestas, suma de puntos almacenados, clasificación densa y un resultado por jugador, excluyendo al host.
- [x] 4.6 Liberar reservas en la misma transacción de finalización y probar rollback completo ante fallos, sin dejar sala finalizada con resultados o reservas incompletos.

## 5. Procesamiento de plazos y recuperación

- [x] 5.1 Implementar descubrimiento periódico de plazos y recuperación al arrancar, con bloqueo transaccional y sala/pregunta/plazo esperado para cada ejecución.
- [x] 5.2 Resolver retrasos con cierre efectivo en `closesAt`, revisión hasta cierre más 5 segundos y apertura de la siguiente al tiempo real; no saltar preguntas nunca abiertas.
- [x] 5.3 Probar desconexión del host, recuperación tras reinicio, ejecutores duplicados y limpieza de temporizadores/recursos al detener el módulo.

## 6. Proyecciones y endpoints REST

- [x] 6.1 Implementar `SessionState` y `Participant` con los campos exactos, fechas UTC, fases derivadas, imágenes firmadas y orden estable; ocultar soluciones hasta revisión y devolver resultados solo al finalizar.
- [x] 6.2 Implementar DTOs de creación/join y validación de UUID, duración numérica 15/30, código normalizado y campos desconocidos, sin aceptar identidades o roles del cuerpo.
- [x] 6.3 Implementar `POST /sessions`, `GET /sessions/{id}`, `POST /sessions/join` y `DELETE /sessions/{id}/participants/me` con los estados HTTP definidos y controladores sin reglas de negocio.
- [x] 6.4 Implementar autorización de consulta para host y participantes, con 404 para ajenos y acceso al historial de participantes después de finalizar.
- [x] 6.5 Incorporar errores `{ statusCode, code, message }` limitados a las rutas nuevas, incluyendo autenticación y validación anteriores al controlador, sin cambiar contratos existentes ni filtrar SQL.
- [x] 6.6 Registrar el módulo y documentar contratos REST y catálogo de errores en OpenAPI; no agregar rutas de iniciar/avanzar/finalizar ni un Gateway fuera del alcance.

## 7. Pruebas de aceptación, concurrencia y aislamiento

- [x] 7.1 Probar las rutas REST con JWT ausente/inválido, cuestionario ajeno, duración inválida, campo extra y código desconocido; verificar cuerpo y estado exactos de errores.
- [x] 7.2 Probar creación y copia independiente ante edición/eliminación del original, y proyección sin claves de respuestas pendientes/abiertas para host y jugador.
- [x] 7.3 Probar segundo join secuencial y simultáneo a la misma sala: mismo participante/fecha y una única reserva; probar prohibición de host y nuevos joins en curso/finalizados.
- [x] 7.4 Probar con conexiones independientes dos joins del mismo usuario a distintas salas: exactamente un éxito y un `ALREADY_IN_ACTIVE_SESSION`; verificar liberación por salida/finalización y no por desconexión.
- [x] 7.5 Probar dos inicios simultáneos y carrera salida/inicio: un único arranque y ninguna alteración posterior de participantes.
- [x] 7.6 Probar plazos de 15/30 segundos, respuesta aceptada antes del límite, exclusión en el límite exacto y cierre por todos respondidos con fixtures persistidos; duplicados o respuestas ajenas no cuentan.
- [x] 7.7 Probar revisión completa de 5 segundos, avance manual/automático concurrente, comando con pregunta obsoleta y finalización frente a temporizador; ninguna carrera debe saltar preguntas ni duplicar resultados.
- [x] 7.8 Probar finalización en espera, durante pregunta y durante revisión; omisiones en cero, empates, host excluido y preguntas nunca abiertas sin contribuir a resultados.
- [x] 7.9 Ejecutar dos salas simultáneas con jugadores distintos y plazos diferentes; comprobar aislamiento de códigos, preguntas, respuestas, reservas, transiciones y resultados.

## 8. Documentación y verificación de entrega

- [x] 8.1 Documentar en README la máquina de estados, configuración al crear, ejemplos REST, salida en espera, exclusividad, preflight/migración y ejecución segura de las nuevas pruebas.
- [x] 8.2 Documentar la interfaz interna para futuros adaptadores P3/P4 y para aceptación de respuestas, distinguiéndola de eventos/acks y puntuación todavía no especificados.
- [x] 8.3 Ejecutar build, unitarias y nuevas pruebas REST/integración en BD de pruebas; revisar cobertura de escenarios de ambos specs y ausencia de recursos abiertos en las nuevas suites.
- [x] 8.4 Verificar regresión de suites existentes y seed idempotente exclusivamente en un entorno de pruebas preparado; registrar resultados reales y cualquier bloqueo sin declarar pruebas omitidas como aprobadas.
