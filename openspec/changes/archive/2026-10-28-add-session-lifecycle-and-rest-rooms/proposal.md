## Why

P2 necesita una base de dominio que controle las partidas sin reglas de negocio en los transportes. Actualmente existen las entidades, pero no los comandos ni los contratos para crear salas, participar y ejecutar transiciones seguras; esta base desbloquea el trabajo posterior de P3 y P4.

## What Changes

- Definir y desarrollar el ciclo de sala `WAITING → IN_PROGRESS → FINISHED` y pregunta `PENDING → OPEN → CLOSED`, con permisos exclusivos del host y protección contra inicios simultáneos.
- Configurar al crear la sala 15 o 30 segundos por pregunta; cerrar por vencimiento o por todas las respuestas aceptadas y mostrar la solución durante 5 segundos antes de avanzar automáticamente.
- Permitir avance del host sin saltar la revisión y finalización anticipada; conservar lo jugado, asignar cero a omisiones y no reiniciar partidas finalizadas.
- Crear una copia consistente del cuestionario y sus preguntas al crear la sala, manteniendo al host fuera de los participantes y resultados.
- Incorporar REST autenticado para crear, consultar, unirse y abandonar durante la espera, con códigos únicos, join idempotente y una sola sala activa por jugador incluso ante concurrencia.
- Establecer proyecciones seguras de estado, errores de dominio estables y pruebas de aislamiento entre salas.
- Limitar este cambio a los pasos 1 y 2: dominio del ciclo de vida y salas REST. Los eventos/acks WebSocket, el endpoint de envío de respuestas y la fórmula de puntuación se especificarán en cambios posteriores. El cierre por todas las respuestas se verificará mediante respuestas ya aceptadas por una interfaz de dominio, sin inventar ese contrato público.

## Capabilities

### New Capabilities

- `session-lifecycle`: Transiciones, permisos, tiempos, revisión, finalización, persistencia y exclusión de operaciones fuera de orden.
- `session-rooms`: Creación REST, códigos, consulta autorizada, participación idempotente, salida en espera y exclusión de participación entre salas activas.

### Modified Capabilities

Ninguna. Se respeta la copia de preguntas ya exigida por `quiz-authoring`, sin cambiar sus requisitos.

## Impact

- Área principal: `src/sessions`, registro del módulo en la aplicación y reutilización de autenticación, perfiles y proyección de imágenes existentes.
- Nuevos contratos: `POST /sessions`, `GET /sessions/{id}`, `POST /sessions/join` y `DELETE /sessions/{id}/participants/me`. Los comandos de iniciar, avanzar y finalizar se exponen en el dominio; su transporte WebSocket no se implementa aquí.
- Migración incremental para duración, marcas de cierre/revisión y reserva exclusiva de participación activa; no modificar la migración inicial ni borrar historial existente.
- Pruebas unitarias con reloj controlado y pruebas REST/integración en PostgreSQL de pruebas, incluyendo solicitudes simultáneas y dos salas.
- Sin cambio de proveedor de autenticación, sin cliente frontend y sin requisito de Redis ni Gateway nuevo en esta etapa.
