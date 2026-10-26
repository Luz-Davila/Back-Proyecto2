## ADDED Requirements

### Requirement: Perfil creado en el primer acceso

La API SHALL crear el perfil del usuario autenticado la primera vez que se consulta, tomando el nombre
inicial de `user_metadata.display_name` y, si no existe, de la parte local del correo.

#### Scenario: Primer acceso sin perfil previo

- **WHEN** un usuario autenticado consulta `GET /profiles/me` y no tiene perfil
- **THEN** la API crea el perfil con su `userId` y devuelve el nombre inicial

#### Scenario: Segundo acceso

- **WHEN** el mismo usuario vuelve a consultar `GET /profiles/me`
- **THEN** la API devuelve el perfil existente sin sobrescribir el nombre que ya tenía

### Requirement: Edición del nombre visible

La API SHALL permitir actualizar únicamente el perfil del usuario dueño del token.

#### Scenario: Cambio de nombre válido

- **WHEN** un usuario autenticado envía `PATCH /profiles/me` con un `displayName` de 2 a 40 caracteres
- **THEN** la API guarda el nombre recortando los espacios y devuelve el perfil actualizado

#### Scenario: Nombre inválido

- **WHEN** el `displayName` tiene menos de 2 o más de 40 caracteres, o no es texto
- **THEN** la API responde 400 y no modifica el perfil

#### Scenario: Perfil ajeno

- **WHEN** un usuario intenta modificar el perfil de otra persona
- **THEN** la API responde 404 porque no existen rutas que reciban un identificador de perfil ajeno

### Requirement: Acceso autenticado

La API SHALL exigir un token de Supabase Auth válido en todas las rutas salvo las marcadas como públicas.

#### Scenario: Token ausente o inválido

- **WHEN** una petición llega sin encabezado `Authorization: Bearer` o con un token vencido, de otro
  emisor o de otra audiencia
- **THEN** la API responde 401 y no ejecuta la operación

#### Scenario: Ruta pública

- **WHEN** se consulta `GET /health` o `GET /`
- **THEN** la API responde sin exigir token
