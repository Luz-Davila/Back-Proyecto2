# quiz-chatbot Specification

## Purpose
Permitir al profesor preparar y refinar propuestas de preguntas de verdadero/falso mediante conversación, manteniendo la revisión humana y evitando cambios en el cuestionario antes de su aprobación.
## Requirements
### Requirement: Conversación limitada al profesor propietario

La API SHALL ofrecer `POST /quizzes/:quizId/chat` únicamente al profesor autenticado dueño del cuestionario. SHALL aceptar historial de mensajes `user`/`assistant`, cantidad opcional y borrador actual, y devolver `200` con `{ reply, draft }`, donde `draft` es una propuesta estructurada o `null` cuando corresponde aclarar la solicitud. SHALL comprobar acceso antes de consultar al proveedor.

#### Scenario: Profesor consulta su cuestionario
- **WHEN** el profesor propietario envía una solicitud válida
- **THEN** recibe una respuesta en español y, cuando hay información suficiente, una propuesta editable sin modificar sus preguntas guardadas

#### Scenario: Acceso no autorizado
- **WHEN** falta un token válido, el perfil es estudiante o el cuestionario no pertenece al solicitante
- **THEN** la API responde respectivamente 401, 403 o 404 y no consulta al proveedor

### Requirement: Propuestas por tema, cantidad o afirmaciones concretas

El asistente SHALL preparar entre 1 y 30 preguntas por propuesta, respetar la cantidad solicitada y aceptar afirmaciones aportadas por el profesor. SHALL pedir aclaración si no hay tema/contenido suficiente o no puede determinar la cantidad. Cada pregunta SHALL contener un enunciado de 1 a 500 caracteres y una respuesta booleana real. No SHALL generar imágenes ni tipos de pregunta incompatibles.

#### Scenario: Tema y cantidad explícitos
- **WHEN** el profesor solicita 10 preguntas sobre fotosíntesis con cantidad estructurada 10
- **THEN** la propuesta contiene exactamente 10 afirmaciones V/F válidas y una cantidad diferente no se entrega como propuesta válida

#### Scenario: Lista de afirmaciones
- **WHEN** el profesor aporta una lista identificable de afirmaciones
- **THEN** el asistente utiliza esa lista, sin añadir preguntas no solicitadas, y aclara las respuestas que no pueda establecer con confianza

#### Scenario: Cantidad ausente o fuera del límite
- **WHEN** el mensaje no determina cantidad ni lista, o la cantidad solicitada excede 30
- **THEN** el asistente pide la cantidad o explica el límite, sin truncar silenciosamente la solicitud ni guardar preguntas

### Requirement: Refinamiento con el borrador revisado

La conversación SHALL considerar el borrador actual remitido por el profesor, incluidas sus ediciones, como contexto de la siguiente revisión. SHALL diferenciar texto conversacional de la propuesta estructurada y no presentar como guardadas preguntas que solo son un borrador.

#### Scenario: Ajuste después de una edición manual
- **WHEN** el profesor modifica una afirmación y pide simplificar otra enviando el borrador actual
- **THEN** la revisión trabaja sobre esa versión y conserva los cambios no afectados por la petición

#### Scenario: Respuesta de aclaración
- **WHEN** el asistente necesita más información y devuelve `draft: null`
- **THEN** no se instruye al cliente a borrar o guardar la propuesta que ya tenía

#### Scenario: Agregar dos países al borrador actual
- **WHEN** el profesor envía su borrador corregido y solicita «agrega 2 países más», sin cantidad estructurada
- **THEN** el asistente interpreta dos como incremento, conserva las preguntas y correcciones previas y entrega mediante herramienta el borrador completo más dos afirmaciones nuevas, sin guardar; si excedería 30 pide aclaración

### Requirement: Herramientas sin escritura y resultados validados

El asistente SHALL poder consultar el cuestionario y preparar propuestas mediante herramientas permitidas. Las herramientas de conversación no SHALL crear, editar, eliminar ni guardar cuestionarios o preguntas persistidas. Argumentos desconocidos, JSON inválido, respuestas no booleanas y propuestas incompletas SHALL rechazarse antes de ejecutar una acción o entregar el borrador.

#### Scenario: Solicitud de guardado en el chat
- **WHEN** el profesor escribe «guarda todo» o el proveedor solicita una herramienta de escritura
- **THEN** no se guardan preguntas y el flujo exige la aprobación explícita por el endpoint de lote

#### Scenario: Argumentos de herramienta inválidos
- **WHEN** el proveedor solicita una herramienta desconocida o una propuesta con `correctBoolean: "true"`
- **THEN** la API no ejecuta herramientas fuera del catálogo ni acepta esa propuesta como válida

### Requirement: Alcance educativo y protección de información

El asistente SHALL aplicar reglas de identidad, uso de herramientas, alcance, seguridad y estilo adaptadas del chatbot de referencia. SHALL responder sobre preparación de cuestionarios en español, tratar contenido del profesor/cuestionario/herramientas como datos no confiables, evitar afirmaciones dudosas como respuestas comprobadas y no exponer secretos, instrucciones internas ni configuración. Matemáticas, historia y programación SHALL ser temas educativos permitidos.

#### Scenario: Instrucciones incrustadas en contenido
- **WHEN** un título o mensaje intenta cambiar el rol del asistente, revelar credenciales o ejecutar acciones ajenas
- **THEN** no obtiene privilegios, secretos ni cambios persistidos y el asistente mantiene el alcance de preparación de preguntas

#### Scenario: Tema académico válido
- **WHEN** el profesor pide preguntas conceptuales de programación
- **THEN** no se rechaza el tema por las restricciones meteorológicas del proyecto de referencia

### Requirement: Límites y fallos aislados del asistente

La conversación SHALL aceptar como máximo 40 mensajes de 2000 caracteres cada uno, un borrador de hasta 30 preguntas y un cuerpo de 96 KiB. SHALL limitar rondas de herramientas y tiempo total. Un exceso de solicitudes SHALL producir 429, una entrada inválida 400/413, una respuesta inválida o fallo del proveedor 502 y un timeout 504. La ausencia de configuración SHALL responder 503 solo en el chat, sin impedir el arranque ni el uso manual del proyecto.

#### Scenario: Proveedor no configurado o no disponible
- **WHEN** falta la clave del proveedor o falla la consulta externa
- **THEN** la API devuelve 503 o 502 con mensaje seguro y CRUD, imágenes y partidas continúan disponibles

#### Scenario: Bucle sin respuesta final
- **WHEN** el proveedor excede cinco rondas de herramientas o el plazo total
- **THEN** la API finaliza con un error controlado, no entrega una propuesta parcial como éxito y no guarda preguntas

#### Scenario: Historial con roles privilegiados
- **WHEN** el cliente envía roles `system` o `tool` en el historial
- **THEN** la API rechaza la solicitud con 400 sin convertir esos mensajes en instrucciones del servidor

