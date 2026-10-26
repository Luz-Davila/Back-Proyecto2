## 1. Preparación

- [x] 1.1 Estructura del repositorio y `.env.example` sin valores reales
- [x] 1.2 `.gitignore` que excluye `.env`, `node_modules` y `dist`

## 2. Base de datos

- [x] 2.1 Configuración de TypeORM con validación de variables
- [x] 2.2 Scripts de migración (`generate`, `run`, `revert`, `show`)
- [x] 2.3 Endpoint `GET /health` que comprueba la base
- [x] 2.4 Entidades de perfiles, cuestionarios, preguntas, sesiones, respuestas y resultados
- [x] 2.5 Migración `InitialSchema` aplicada con RLS activo
- [x] 2.6 Restricciones únicas de participante, respuesta y orden de preguntas

## 3. Autenticación

- [x] 3.1 Guard global con validación de firma, emisor, audiencia y expiración
- [x] 3.2 Rutas públicas con `@Public()`
- [x] 3.3 Decorador `@CurrentUser` y `GET /auth/me`
- [x] 3.4 Pruebas de token válido, vencido, otro emisor, otra audiencia y otra clave

## 4. Perfiles

- [x] 4.1 `GET /profiles/me` con creación en el primer acceso
- [x] 4.2 `PATCH /profiles/me` con validación de nombre
- [x] 4.3 Pruebas del servicio y del DTO

## 5. Cuestionarios

- [x] 5.1 CRUD con control de propiedad
- [x] 5.2 Listado con cantidad de preguntas y detalle con preguntas ordenadas
- [x] 5.3 Pruebas de creación, lectura, edición, borrado y accesos ajenos

## 6. Preguntas

- [x] 6.1 Crear al final o en una posición indicada
- [x] 6.2 Reordenar y renumerar en transacción
- [x] 6.3 Editar y eliminar con renumeración
- [x] 6.4 Validación de enunciado y respuesta booleana estricta
- [x] 6.5 Pruebas de orden, renumeración y permisos

## 7. Imágenes

- [x] 7.1 Cliente de Supabase Storage con bucket privado
- [x] 7.2 Validación de tamaño, tipo declarado y bytes reales
- [x] 7.3 Clave generada por el servidor y URL firmada
- [x] 7.4 Reemplazo y borrado de la imagen anterior
- [x] 7.5 Pruebas de validación y del servicio

## 8. Contratos y observabilidad

- [x] 8.1 OpenAPI en `/openapi.json` y Scalar en `/docs`
- [x] 8.2 Ejemplos de éxito y error por endpoint
- [x] 8.3 Telemetría OTLP de trazas y métricas, desactivable

## 9. Pruebas

- [x] 9.1 Pruebas unitarias (77)
- [x] 9.2 Pruebas de integración contra PostgreSQL con transacción revertida (5)
- [ ] 9.3 Pruebas e2e del flujo completo con Playwright (a cargo del frontend)

## 10. Datos de demostración y entrega

- [x] 10.1 Seed idempotente de usuario, perfil, quiz y una imagen
- [x] 10.2 Verificación del seed contra el proyecto de Supabase (requiere la clave de servicio)
- [x] 10.3 README del repositorio con variables, arranque y pruebas
