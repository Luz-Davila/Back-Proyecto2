## Why

El motor de partidas y las salas REST ya existen, pero los dispositivos aún no reciben sus cambios en tiempo real. Los pasos 3 y 4 necesitan un transporte autenticado que publique el mismo estado seguro a los clientes de cada sala, incluyendo las transiciones automáticas, sin trasladar reglas de negocio al Gateway.

## What Changes

- Incorporar un Gateway Socket.IO con JWT de Supabase en `handshake.auth.token`, autenticación por comando y renovación mediante `auth:refresh` sin desconectar mientras el token siga vigente.
- Autorizar suscripciones por `sessionId`, permitir varios dispositivos por cuenta y recuperar el estado actual tras reconectar, sin duplicar participantes.
- Definir comandos `room:join`, `room:subscribe`, `room:leave`, `game:start`, `game:advance`, `game:finish` y sus acknowledgments uniformes. Identidad y permisos proceden del token y del dominio, nunca del cuerpo.
- Publicar `room:state`, `question:opened`, `question:closed` y `game:finished` exclusivamente a suscriptores autorizados de la sala. Incluir cambios producidos por REST y por plazos persistidos, no solo los originados en WebSocket.
- Entregar enunciado, imagen firmada, tiempos de servidor y tiempo restante; omitir completamente `correctBoolean` en preguntas abiertas, también para el host.
- Conservar el snapshot tomado al crear la sala, que ya precede al inicio. No recapturar el quiz al iniciar ni modificar contratos REST existentes.
- Adoptar una instancia de NestJS en el VPS de Hostinger, con múltiples salas simultáneas; recuperación por estado, no replay durable de eventos.
- Excluir `answer:submit`, `answer:ack`, inserción pública de `Answer`, validación de respuestas y fórmula de puntuación: corresponden al paso 5 o a cambios posteriores. No implementar frontend, Redis, cluster ni despliegue del VPS.

## Capabilities

### New Capabilities

- `session-realtime`: autenticación y renovación de sockets, suscripciones autorizadas, múltiples dispositivos, comandos/acks, aislamiento, notificaciones posteriores al commit y recuperación en una instancia.
- `safe-question-delivery`: contrato de preguntas y estado en tiempo real, tiempo restante autoritativo, revelación solo en revisión y uso exclusivo del snapshot existente.

### Modified Capabilities

Ninguna. `session-rooms` y `session-lifecycle` conservan sus contratos y reglas; las capacidades nuevas los reutilizan y agregan su transporte/notificación sin alterar respuestas REST ni tiempos del dominio.

## Impact

- Nuevos adaptadores y contratos de tiempo real en `src/sessions/`; integración con `SessionRoomsService`, `SessionLifecycleService`, repositorio, proyector y procesador de plazos.
- Extensión compatible del verificador de `src/auth/` para obtener expiración verificada; adaptación explícita de guards/filtros al contexto de transporte sin debilitar REST.
- Dependencias de implementación: `@nestjs/websockets` y `@nestjs/platform-socket.io` compatibles con NestJS 11, `socket.io` 4 y `socket.io-client` para pruebas.
- Configuración de orígenes de Socket.IO alineada con `CORS_ORIGIN`; documentación del contrato y requisitos de proxy TLS/WebSocket del VPS. No cambiar la duración de JWT ni manejar refresh tokens desde el backend de juego.
- Pruebas reales con clientes Socket.IO y PostgreSQL exclusivo de pruebas, además de regresión REST/dominio. No se prevé migración de BD para este incremento.
