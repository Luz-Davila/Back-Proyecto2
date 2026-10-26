# ProfeLink · API de actividades

API REST del servicio de evaluaciones en vivo de ProfeLink. Permite administrar perfiles,
cuestionarios de verdadero o falso con imágenes y las copias de preguntas que usan las sesiones de
juego. La autenticación se delega a Supabase Auth, la base de datos y las imágenes viven en Supabase y
la API se despliega por separado del frontend y del servicio de juego en vivo.

## Requisitos

- Node.js 22 o superior
- npm 10 o superior
- Un proyecto de Supabase con Auth, Postgres y Storage
- (Opcional) Un colector OTLP para trazas y métricas

## Configuración

Copia `.env.example` a `.env` y completa los valores:

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | Sí | Cadena de conexión de Supabase Postgres (panel → Connect) |
| `DATABASE_SSL` | No | `true` para Supabase en la nube |
| `SUPABASE_URL` | Sí | `https://<proyecto>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Para imágenes y seed | Clave de servicio. Solo backend, nunca en el repositorio |
| `SUPABASE_STORAGE_BUCKET` | No | Bucket de imágenes (por defecto `question-images`) |
| `PORT` | No | Puerto de la API (por defecto 3000) |
| `CORS_ORIGIN` | No | Origen(es) permitidos, separados por coma |
| `OTEL_SERVICE_NAME` | No | Nombre del servicio en la telemetría |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Si se define, se activa la exportación OTLP |
| `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` | Para el seed | Usuario de demostración |

Sin la clave de servicio la API funciona, pero las rutas de imágenes responden con error de
configuración y el seed no puede crear el usuario.

## Puesta en marcha

```bash
npm install
npm run migration:run   # crea las tablas en Supabase
npm run seed            # usuario, perfil y quiz de demostración (idempotente)
npm run start:dev       # API en http://localhost:3000
```

Comprobaciones rápidas:

- Salud: `GET http://localhost:3000/health`
- Documentación interactiva: `http://localhost:3000/docs`
- Especificación OpenAPI: `http://localhost:3000/openapi.json`

## Pruebas

```bash
npm test                # pruebas unitarias (sin base de datos)
npm run test:integration  # contra PostgreSQL de DATABASE_URL, con transacción revertida
```

Las pruebas de integración se omiten si `DATABASE_URL` no está definida y no dejan datos: cada prueba
corre dentro de una transacción que se revierte al final.

## Migraciones

```bash
npm run migration:generate -- src/database/migrations/NombreDelCambio
npm run migration:run
npm run migration:revert
npm run migration:show
```

`synchronize` está desactivado: todo cambio de esquema debe pasar por una migración.

## Contratos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del servicio y de la base (pública) |
| GET | `/auth/me` | Datos del token ya validado |
| GET | `/profiles/me` | Perfil propio, se crea en el primer acceso |
| PATCH | `/profiles/me` | Cambia el nombre visible |
| GET | `/quizzes` | Cuestionarios propios |
| POST | `/quizzes` | Crea un cuestionario |
| GET | `/quizzes/:id` | Detalle con preguntas ordenadas y URL firmada de imágenes |
| PATCH | `/quizzes/:id` | Edita un cuestionario propio |
| DELETE | `/quizzes/:id` | Elimina un cuestionario propio |
| POST | `/quizzes/:quizId/questions` | Agrega una pregunta |
| PATCH | `/questions/:id` | Edita enunciado, respuesta o posición |
| DELETE | `/questions/:id` | Elimina una pregunta |
| PUT | `/questions/:id/image` | Carga o reemplaza la imagen (multipart, campo `file`) |
| DELETE | `/questions/:id/image` | Elimina la imagen |

Todas las rutas salvo `/health` y `/` exigen `Authorization: Bearer <token de Supabase>`.

Los errores usan el formato estándar de NestJS:

```json
{ "statusCode": 403, "message": "No puedes modificar un cuestionario de otro usuario", "error": "Forbidden" }
```

Códigos usados: 400 validación, 401 sin token válido, 403 contenido ajeno, 404 inexistente o no
revelable, 413 archivo mayor a 2 MB.

## Arquitectura

- **Monolito modular** en NestJS con módulos por capacidad: `auth`, `profiles`, `quizzes`, `storage`.
- **Capas por módulo:** controlador (HTTP y DTO) → servicio (reglas y permisos) → repositorio TypeORM.
- **Autenticación:** Supabase Auth. La API valida el JWT contra el JWKS del proyecto con `jose`
  (firma, `iss`, `exp`, `aud = authenticated`).
- **Base de datos:** PostgreSQL de Supabase con migraciones versionadas y RLS activo sin políticas.
- **Imágenes:** bucket privado de Supabase Storage, validación de bytes reales y URL firmada de 10
  minutos.
- **Observabilidad:** OpenTelemetry con exportación OTLP de trazas y métricas.

La decisión completa, con alternativas y consecuencias, está en
`openspec/specs/` y en el archivo de diseño del cambio archivado.

## Modelo de datos

| Tabla | Propósito |
|---|---|
| `profiles` | Perfil visible del usuario; la clave es el `sub` de Supabase |
| `quizzes` | Cuestionarios y su dueño |
| `questions` | Preguntas de verdadero o falso, con posición e imagen opcional |
| `game_sessions` | Sala con código, anfitrión y estado |
| `session_questions` | Copia del enunciado, la respuesta y la imagen al crear la sesión |
| `session_participants` | Participantes de una sala, único por sesión y usuario |
| `answers` | Una respuesta por participante y pregunta |
| `game_results` | Puntaje y posición final por participante |

## Limitaciones conocidas

- La imagen de demostración del seed se genera en memoria (degradado PNG) para que el seed sea
  reproducible sin archivos binarios.
- Los resultados, el puntaje y el tiempo de respuesta corresponden al servicio de juego en vivo.
- Las pruebas de integración usan la base configurada en `DATABASE_URL`; conviene un proyecto de
  Supabase de pruebas para trabajo en equipo.
- `npm audit` reporta vulnerabilidades heredadas de dependencias del framework; no se aplicó
  `npm audit fix --force` para no romper versiones.

## Estructura

```
src/
  auth/          guard JWT, decoradores y endpoint /auth/me
  config/        validación de variables de entorno
  database/      opciones de conexión, data source del CLI, migraciones y seed
  health/        endpoint de salud
  profiles/      perfil del usuario autenticado
  quizzes/       cuestionarios, preguntas e imágenes
  storage/       cliente de Supabase Storage
  docs/          configuración de OpenAPI y Scalar
  telemetry.ts   arranque de OpenTelemetry
openspec/        especificación del cambio y especificaciones archivadas
```
