## ADDED Requirements

### Requirement: Carga validada de imágenes

La API SHALL aceptar solo imágenes JPG, PNG o WebP de hasta 2 MB, verificando el contenido real del
archivo y no solo su nombre o el tipo declarado.

#### Scenario: Imagen válida

- **WHEN** el dueño envía `PUT /questions/{id}/image` con un archivo PNG de menos de 2 MB
- **THEN** la API guarda la imagen en el almacenamiento y devuelve la clave y una URL firmada temporal

#### Scenario: Formato no permitido

- **WHEN** el archivo no es JPG, PNG ni WebP
- **THEN** la API responde 400 con un mensaje claro y no guarda nada

#### Scenario: Contenido que no coincide

- **WHEN** el archivo declara ser PNG pero sus bytes no corresponden a una imagen
- **THEN** la API responde 400 y no guarda nada

#### Scenario: Archivo demasiado grande

- **WHEN** el archivo supera los 2 MB
- **THEN** la API responde 413 y no guarda nada

### Requirement: Clave generada por el servidor

La API SHALL generar la ruta del objeto y SHALL ignorar el nombre original del archivo.

#### Scenario: Nombre original con caracteres especiales

- **WHEN** se sube un archivo llamado `../../foto final.png`
- **THEN** la clave guardada sigue el patrón `quizzes/{quizId}/questions/{uuid}.png` y no contiene el nombre original

### Requirement: Entrega mediante URL firmada

La API SHALL entregar las imágenes de un bucket privado con una URL firmada de vigencia limitada.

#### Scenario: Consulta del cuestionario

- **WHEN** el dueño consulta el detalle de su cuestionario
- **THEN** cada pregunta incluye la URL firmada de su imagen o `null` si no tiene

#### Scenario: Acceso sin firma

- **WHEN** alguien intenta leer la URL pública del bucket
- **THEN** el acceso se rechaza porque el bucket no es público

### Requirement: Reemplazo y borrado

La API SHALL borrar la imagen anterior al reemplazarla y SHALL limpiar la referencia al eliminarla.

#### Scenario: Reemplazo

- **WHEN** el dueño sube una imagen nueva a una pregunta que ya tenía una
- **THEN** la API guarda la nueva, actualiza la clave y elimina el objeto anterior

#### Scenario: Borrado

- **WHEN** el dueño elimina la imagen de una pregunta
- **THEN** la API borra el objeto del almacenamiento y deja la pregunta sin imagen

#### Scenario: Pregunta sin imagen

- **WHEN** el dueño intenta borrar la imagen de una pregunta que no tiene
- **THEN** la API responde 404

### Requirement: Aislamiento de imágenes

La API SHALL aplicar las mismas reglas de propiedad que el resto de las preguntas.

#### Scenario: Imagen de una pregunta ajena

- **WHEN** un usuario intenta cargar o borrar la imagen de una pregunta de otro creador
- **THEN** la API responde 403 y no toca el almacenamiento
