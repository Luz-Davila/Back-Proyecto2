## Why

El profesor necesita preparar preguntas a partir de un tema, una cantidad o sus propias afirmaciones, sin perder el control sobre su contenido. Adaptar a NestJS el patrón de tool calling del chatbot C# permite generar propuestas revisables y guardar únicamente la versión aprobada.

## What Changes

- Incorporar un chatbot DeepSeek autenticado, exclusivo del profesor dueño del cuestionario, que consulte servicios internos y entregue borradores estructurados de verdadero/falso.
- Adaptar la estructura del system prompt C#: identidad, herramientas, alcance, seguridad, contexto y estilo; sustituir las reglas meteorológicas por reglas educativas y de revisión previa.
- Separar conversación sin escrituras de cuestionarios/preguntas y confirmación explícita de un lote editado por el profesor.
- Añadir guardado transaccional e idempotente por lote y coordinación con las ediciones manuales existentes.
- Organizar controlador, cliente del proveedor, orquestador, prompt, herramientas, validadores y persistencia en archivos pequeños con responsabilidades independientes.
- Documentar configuración exclusivamente de backend y pruebas de regresión; detenerse tras la planificación para que el usuario configure su clave local antes de implementar y realizar una prueba real consentida.

## Capabilities

### New Capabilities

- `quiz-chatbot`: conversación con DeepSeek, propuestas editables mediante tool calling de servicios internos, restricciones y errores del proveedor.

### Modified Capabilities

- `quiz-authoring`: agregado explícito de preguntas aprobadas por lote con validación, atomicidad, orden e idempotencia sin cambiar los contratos CRUD existentes.

## Impact

- Nuevo módulo `src/chatbot/`; exportaciones de servicios de `QuizzesModule`, reutilización de `ProfilesService.requireTeacher` y autenticación existente.
- Nuevos contratos REST de backend (dueño P1/P2): `POST /quizzes/:quizId/chat` y `POST /quizzes/:quizId/questions/batch`; los contratos existentes y Socket.IO no cambian.
- Nueva migración para registrar operaciones de lote; el historial conversacional y los borradores no requieren persistencia en esta versión.
- Configuración DeepSeek en `.env.example`, sin claves en código, navegador, logs o artifacts. La ausencia de clave no impide usar funcionalidades previas.
- Cambio compañero: `kahoot_front_grupo2/openspec/changes/add-quiz-chatbot-ui`. Este cambio no implementa interfaz ni modifica el proyecto C# de referencia.
- Fuera de alcance: guardar desde el modelo, borrar/reemplazar preguntas existentes, modificar metadatos desde el chat, generar imágenes, opción múltiple, SSE y herramientas de partidas.
