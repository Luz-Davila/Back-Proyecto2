## Why

ProfeLink necesita un área de actividades para evaluaciones cortas en vivo. La persona 1 del equipo
es responsable de la base de datos, la API REST y las imágenes: sin esos cimientos los demás
integrantes no pueden construir el juego en vivo, el frontend ni el despliegue.

## What Changes

- Modelo relacional en PostgreSQL (Supabase) con migraciones versionadas: perfiles, cuestionarios,
  preguntas, sesiones, participantes, respuestas y resultados.
- Las sesiones guardan una **copia** del enunciado, la respuesta y la imagen de cada pregunta, de modo
  que editar o borrar el cuestionario no altera los resultados históricos.
- Autenticación con Supabase Auth: la API valida el JWT contra el JWKS del proyecto, con emisor y
  audiencia `authenticated`.
- CRUD de perfiles, cuestionarios y preguntas con control de propiedad en el backend.
- Imágenes de pregunta en Supabase Storage (bucket privado), con validación de formato y tamaño y
  entrega mediante URL firmada temporal.
- Documentación OpenAPI con Scalar y telemetría con OpenTelemetry.
- RLS activado sin políticas en todas las tablas, porque Supabase expone el esquema `public`.

## Capabilities

### New Capabilities

- `profiles`: perfil del usuario autenticado, creado en el primer acceso y editable solo por su dueño.
- `quiz-authoring`: creación, consulta, edición y borrado de cuestionarios y sus preguntas, con orden
  estable y aislamiento entre creadores.
- `question-images`: carga, reemplazo, borrado y entrega de la imagen opcional de una pregunta.

### Modified Capabilities

Ninguna: es la primera especificación de este repositorio.

## Impact

- Código nuevo en `src/profiles`, `src/quizzes`, `src/auth`, `src/storage`, `src/database` y `src/docs`.
- Dependencias nuevas: `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/config`, `jose`, `class-validator`,
  `class-transformer`, `@nestjs/swagger`, `@scalar/nestjs-api-reference`, `@types/multer` y el SDK de
  OpenTelemetry.
- Variables de entorno nuevas: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`,
  `CORS_ORIGIN` y las de OTLP.
- Base de datos: migración `InitialSchema` aplicada sobre Supabase.
- Consumidores: el frontend y el servicio de juego dependen de estos contratos; un proyecto externo
  puede consumir la API documentada en `/openapi.json`.
