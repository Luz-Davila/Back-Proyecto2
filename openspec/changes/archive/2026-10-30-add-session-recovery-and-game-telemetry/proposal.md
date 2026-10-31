## Why

Las partidas ya conservan participantes, respuestas, puntuación y deadlines, pero falta una recuperación por código con contrato explícito y evidencia reproducible de reconexión/reinicio. Los pasos 7–8 también necesitan métricas del juego y pruebas multiusuario medibles, sin confundir corrección funcional con capacidad máxima de producción.

## What Changes

- Agregar `GET /sessions/:code/state`, con JWT vigente y acceso solo a host/participante persistido, devolviendo el `RoomEnvelope` actual sin crear jugadores, modificar puntajes ni sustituir `GET /sessions/:id`.
- Ampliar la recuperación de `room:join`: la misma identidad recupera su participante, snapshot y acumulado también en FINISHED; los jugadores nuevos siguen limitados a WAITING. El host usa consulta/suscripción y no se convierte en jugador.
- **BREAKING de comportamiento:** un join de participante ya registrado en FINISHED deja de responder SESSION_FINISHED y devuelve su participación existente. Se mantiene el shape exacto de REST por id, join REST, room:join, comprobantes y errores.
- Documentar y probar reinicio real de un proceso local con la misma BD: deadlines continúan, stream nuevo y resuscripción explícita, sin replay, pausa artificial, nuevas respuestas ni nueva participación.
- Instrumentar contadores y latencias del juego con atributos acotados, sin secretos ni identificadores de sala/usuario; separar operaciones confirmadas, reintentos y rechazos, sin afectar reglas o disponibilidad.
- Preparar pruebas de dos salas y un ejecutor local reproducible de concurrencia que genere evidencia real, criterios y mayor nivel probado, distinguiendo jugadores de sockets y pruebas simuladas de dispositivos físicos.
- Dejar una guía manual de dispositivos/VPS y de conexión futura de métricas. La cuenta, servicio, dashboards y validación visual de Grafana quedan diferidos por decisión del usuario; no bloquean las pruebas locales ni se dan por completados.

## Capabilities

### New Capabilities

- `game-telemetry`: métricas observables del juego, semántica de contadores/latencias, privacidad y verificación local sin Grafana.
- `multiuser-verification`: ejecución reproducible de concurrencia, evidencia de recuperación/reinicio, criterios de aceptación y reporte honesto del nivel concurrente probado.

### Modified Capabilities

- `session-rooms`: consulta segura por código con envelope y recuperación idempotente de participación finalizada, conservando consulta REST por id y exclusividad activa.
- `session-realtime`: room:join recuperable también en FINISHED, con suscripción autorizada y contrato previo sin duplicados.
- `safe-question-delivery`: reutilización explícita del envelope en la nueva consulta HTTP por código, sin cambiar SessionState ni filtrar respuestas/soluciones OPEN.

## Impact

- Servicios/controlador/DTO/OpenAPI de sesiones, lookup por código y autorización/serialización existentes; instrumentación transversal en límites de comando, dominio, cola, worker y notificaciones. El Gateway conserva solo responsabilidades de transporte.
- Reutilización de OpenTelemetry/OTLP y PostgreSQL ya instalados; pruebas con recolector/exportador en memoria y JWT locales. No se prevén migraciones, cambios de fórmula, Redis ni varias instancias.
- Nuevos ejecutores, pruebas y documentación de recuperación, contratos P3/P4 y resultados medidos. Ningún cambio de código se autoriza en esta fase de propuesta.
- Fuera de alcance: nuevo frontend, replay durable, respuestas personales añadidas al snapshot, despliegue o reinicio del VPS, Supabase de producción, cuenta/configuración de Grafana y certificación de capacidad productiva. Las demostraciones externas se registrarán como pendientes hasta ejecutarlas con autorización.
