# quiz-authoring Specification

## Purpose
TBD - created by archiving change api-base. Update Purpose after archive.
## Requirements
### Requirement: Administración de cuestionarios propios

Un usuario autenticado con perfil SHALL poder crear, listar, consultar, editar y eliminar sus propios
cuestionarios.

#### Scenario: Creación

- **WHEN** un usuario autenticado envía `POST /quizzes` con un título de 3 a 120 caracteres
- **THEN** la API crea el cuestionario a su nombre y lo devuelve con su identificador

#### Scenario: Listado

- **WHEN** un usuario autenticado consulta `GET /quizzes`
- **THEN** la API devuelve solo sus cuestionarios, ordenados por fecha de actualización

#### Scenario: Detalle

- **WHEN** el dueño consulta `GET /quizzes/{id}`
- **THEN** la API devuelve el cuestionario con sus preguntas ordenadas por posición

#### Scenario: Eliminación

- **WHEN** el dueño elimina su cuestionario
- **THEN** la API borra el cuestionario y sus preguntas, y conserva las copias de las sesiones ya creadas

### Requirement: Aislamiento entre creadores

La API SHALL impedir que un usuario modifique contenido de otro y SHALL no revelar la existencia de
cuestionarios ajenos al consultarlos.

#### Scenario: Modificar cuestionario ajeno

- **WHEN** un usuario intenta editar o eliminar un cuestionario de otra persona
- **THEN** la API responde 403 y no aplica cambios

#### Scenario: Consultar cuestionario ajeno

- **WHEN** un usuario consulta un cuestionario de otra persona
- **THEN** la API responde 404

### Requirement: Administración de preguntas de verdadero o falso

El dueño del cuestionario SHALL poder agregar, editar y eliminar preguntas con enunciado, respuesta
booleana, posición e imagen opcional.

#### Scenario: Agregar al final

- **WHEN** el dueño envía `POST /quizzes/{id}/questions` sin posición
- **THEN** la API agrega la pregunta después de la última y le asigna la posición siguiente

#### Scenario: Insertar en una posición

- **WHEN** el dueño indica una posición entre 0 y la cantidad actual de preguntas
- **THEN** la API inserta la pregunta en esa posición y renumera el resto sin dejar huecos ni duplicados

#### Scenario: Posición fuera de rango

- **WHEN** el dueño indica una posición mayor que la cantidad de preguntas
- **THEN** la API responde 400 y no modifica el cuestionario

#### Scenario: Respuesta mal escrita

- **WHEN** la respuesta llega como texto `"true"` o `"false"` en lugar de un booleano
- **THEN** la API responde 400 y no guarda la pregunta

#### Scenario: Eliminar una pregunta intermedia

- **WHEN** el dueño elimina una pregunta
- **THEN** la API renumera las restantes desde cero y conserva la copia usada por sesiones anteriores

### Requirement: Consistencia de la partida

Las sesiones SHALL usar una copia de las preguntas y no depender del cuestionario original.

#### Scenario: Cuestionario editado después de crear la sesión

- **WHEN** el creador modifica una pregunta después de que existe una sesión
- **THEN** la sesión mantiene el enunciado, la respuesta y la imagen que copió al crearse

#### Scenario: Cuestionario eliminado

- **WHEN** el creador elimina el cuestionario
- **THEN** las sesiones conservan su título y sus copias de preguntas, y la referencia al cuestionario queda vacía

