## Context

ProfeLink es una aplicación de actividades en vivo. Este repositorio es la API del servicio de
actividades y se despliega de forma independiente. El frontend (React) y el servicio de juego en vivo
consumen sus contratos por red; ninguno accede a su base ni a su código.

## Goals / Non-Goals

**Goals**

- Una API REST con contratos estables y documentados.
- Reglas de propiedad y validación en el backend, nunca en el cliente.
- Datos e imágenes persistentes, entregados desde componentes administrados.
- Base para que el juego en vivo consuma copias de las preguntas.

**Non-Goals**

- Gateway de WebSocket, temporizadores y cálculo de puntajes: pertenecen a otra persona del equipo.
- Pantallas de React.
- Panel administrativo.

## Decisions

### Monolito modular sobre NestJS

La API se organiza en módulos por capacidad (`auth`, `profiles`, `quizzes`, `storage`), no en
microservicios. Las reglas del juego en vivo no viven aquí. El motivo es que un solo equipo pequeño
mantiene el servicio y los límites por módulo ya permiten separarlo después si crece.

### Capas por módulo

Cada módulo sigue el mismo flujo: controlador (entrada HTTP y validación de DTO) → servicio (reglas y
permisos) → repositorio TypeORM (acceso a datos). Los controladores no tocan la base y los servicios no
conocen HTTP.

### Autenticación delegada a Supabase Auth

El equipo y el profesor acordaron usar Supabase Auth como servicio de autenticación, sin construir una
API de autenticación propia. La API valida el JWT contra el JWKS del proyecto con `jose`, comprobando
firma, `iss`, `exp` y `aud = authenticated`. El `sub` identifica al usuario en todas las tablas.

### PostgreSQL administrado con migraciones versionadas

Se usa Supabase Postgres con `synchronize: false`. Todo cambio de esquema pasa por una migración
versionada, y el CLI lee la misma configuración que la API. RLS queda activo sin políticas porque el
esquema `public` es accesible por la API de Supabase; la API accede con su propia conexión y valida
permisos en los servicios.

### Copia de preguntas por sesión

`session_questions` guarda enunciado, respuesta, posición y clave de imagen. La referencia a la pregunta
original usa `ON DELETE SET NULL`, y la referencia al cuestionario también. Así editar o borrar un
cuestionario no cambia resultados históricos.

### Orden de preguntas con renumeración transaccional

La base impone `UNIQUE(quiz_id, position)`. Insertar, mover o borrar se resuelve en una transacción que
primero mueve las filas afectadas a posiciones negativas y luego asigna las definitivas, evitando
choques intermedios.

### Imágenes en Supabase Storage

Bucket privado. La API valida tamaño, tipo declarado y bytes reales, genera la clave
`quizzes/{quizId}/questions/{uuid}.{ext}` y entrega URL firmada de 10 minutos. La clave de servicio vive
solo en el backend.

### Errores uniformes y documentación

Formato estándar de NestJS (`statusCode`, `message`, `error`), con 400 para validación, 401 sin token
válido, 403 al modificar contenido ajeno, 404 cuando no existe o no debe revelarse, y 413 para archivos
grandes. OpenAPI se expone en `/openapi.json` y Scalar en `/docs`.

### Telemetría

OpenTelemetry con exportación OTLP de trazas y métricas, activa solo si
`OTEL_EXPORTER_OTLP_ENDPOINT` está definido. La instrumentación automática cubre HTTP y `pg`.

## Risks / Trade-offs

- **Supabase como dependencia externa:** sin internet no hay login, base ni imágenes. Mitigación: el
  script de inicio y el Compose quedan en la parte de despliegue del equipo.
- **Validación del JWT con JWKS remoto:** el primer login depende de la caché de claves de Supabase;
  si se rotan claves, la caché debe refrescarse.
- **RLS sin políticas:** bloquea el acceso directo por anon key, pero obliga a que cualquier consulta
  pase por la API.
- **Bucket privado con URL firmada:** las URLs vencen a los 10 minutos, así que la vista de pregunta
  debe pedir el detalle cuando expira.

## Migration Plan

1. Aplicar `InitialSchema` con `npm run migration:run`.
2. Configurar variables en `.env` a partir de `.env.example`.
3. Ejecutar `npm run seed` para el usuario y el quiz de demostración.
4. Arrancar con `npm run start:dev` y verificar `/health`, `/docs` y `/openapi.json`.

El retroceso se hace con `npm run migration:revert`, que elimina las tablas creadas.

## Open Questions

- Confirmar con el equipo si el despliegue final usará Compose con PostgreSQL local además de Supabase.
- Definir el límite máximo de participantes simultáneos para la prueba de carga, que corresponde a la
  parte del juego en vivo.
