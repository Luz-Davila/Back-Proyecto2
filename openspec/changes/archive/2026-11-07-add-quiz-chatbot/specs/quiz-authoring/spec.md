## ADDED Requirements

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
