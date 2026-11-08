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

### Requirement: Agregado explícito de preguntas aprobadas por lote

La API SHALL ofrecer `POST /quizzes/:quizId/questions/batch` al profesor autenticado propietario. SHALL aceptar `{ operationId, questions }`, con identificador UUID y entre 1 y 30 preguntas revisadas de enunciado de 1 a 500 caracteres y respuesta booleana. SHALL agregar al final exactamente el contenido aprobado y devolver `200` con `{ operationId, questions }`, incluyendo los identificadores y posiciones asignados. No SHALL reemplazar preguntas existentes ni requerir al proveedor de IA para guardar.

#### Scenario: Guardar una propuesta editada
- **WHEN** el profesor aprueba ocho preguntas después de editar sus enunciados/respuestas y excluir dos de una propuesta de diez
- **THEN** se agregan únicamente las ocho versiones aprobadas, en el orden enviado y después de las preguntas existentes

#### Scenario: Lote inválido o sin permisos
- **WHEN** hay un enunciado vacío, una respuesta de texto, más de 30 preguntas, perfil estudiante o cuestionario ajeno
- **THEN** la API rechaza la solicitud con 400, 403 o 404 según corresponda y no agrega ninguna pregunta

### Requirement: Guardado de lote atómico y orden consistente

El lote SHALL guardarse completo o no guardarse. El agregado por lote y las operaciones manuales concurrentes SHALL conservar posiciones únicas y contiguas desde cero, sin perder cambios confirmados. Las sesiones creadas previamente SHALL conservar sus copias originales.

#### Scenario: Error durante el guardado
- **WHEN** falla la persistencia de una pregunta del lote
- **THEN** no queda ninguna pregunta ni confirmación de operación de ese lote y las preguntas anteriores permanecen intactas

#### Scenario: Edición manual concurrente
- **WHEN** coinciden un agregado por lote y una inserción, movimiento o eliminación manual
- **THEN** las operaciones se coordinan sin posiciones duplicadas, huecos ni pérdida de preguntas confirmadas

#### Scenario: Partida previa al agregado
- **WHEN** se agregan preguntas después de crear una partida
- **THEN** esa partida conserva las preguntas y respuestas copiadas al crearse

### Requirement: Reintentos de lote sin duplicados

La confirmación SHALL ser idempotente por usuario, cuestionario y `operationId`, incluso después de reiniciar el servidor. Un reintento con el mismo contenido normalizado SHALL devolver el mismo recibo sin insertar otra vez. Reutilizar el identificador con contenido distinto SHALL devolver 409. Cada reintento SHALL volver a verificar autenticación, rol y propiedad.

#### Scenario: Respuesta perdida después del commit
- **WHEN** el profesor reenvía el mismo identificador y contenido porque no recibió la respuesta
- **THEN** obtiene el recibo original sin duplicar las preguntas, aunque el backend se haya reiniciado

#### Scenario: Identificador reutilizado con cambios
- **WHEN** se reenvía un identificador ya confirmado con una respuesta o enunciado diferente
- **THEN** la API responde 409 sin alterar el lote anterior

### Requirement: Compatibilidad de autoría y funcionalidades previas

Los contratos existentes de cuestionarios, preguntas individuales, imágenes y sesiones SHALL conservar sus rutas, validaciones, respuestas y aislamiento entre usuarios. El agregado del asistente no SHALL hacer obligatoria su configuración para esas operaciones.

#### Scenario: Autoría manual sin clave de IA
- **WHEN** el profesor crea, edita, reordena o elimina una pregunta y gestiona sus imágenes sin configurar el asistente
- **THEN** esas operaciones mantienen su funcionamiento previo y no consultan al proveedor de IA

