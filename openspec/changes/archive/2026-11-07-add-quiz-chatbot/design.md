## Context

Ver `proposal.md` para la motivación. El backend usa NestJS, validación global y servicios de autoría con transacciones individuales. `QuizzesModule` no exporta sus servicios. `questions` exige unicidad de `(quizId, position)` y las partidas ya conservan copias independientes. La referencia C# separa controlador, cliente DeepSeek, orquestación y ejecutores, con cinco rondas máximas, pero solo consulta datos y no entrega borradores estructurados.

Este diseño es necesario por el nuevo proveedor externo, la frontera de aprobación, la coordinación de escrituras y la migración de idempotencia. El cambio compañero vive en `kahoot_front_grupo2/openspec/changes/add-quiz-chatbot-ui`; el contrato REST pertenece a este backend (P1/P2).

## Goals / Non-Goals

**Goals:** dependencias acíclicas, servicios reutilizables, controlador delgado, generación sin escrituras de autoría, confirmación independiente de la IA y regresiones verificables.

**Non-Goals:** un framework general de agentes, LangChain, un servidor C# adicional, HTTP del backend hacia sí mismo, almacenamiento de conversaciones o acceso del modelo a herramientas de escritura.

## Decisions

### 1. Módulos y archivos por responsabilidad

Organización orientativa; extraer por responsabilidad, no crear un archivo monolítico ni fragmentar artificialmente funciones triviales. Objetivo de revisión: aproximadamente 200 líneas por archivo nuevo de producción; dividir antes de superar ese tamaño salvo justificación concreta.

```text
src/chatbot/
  chatbot.module.ts
  quiz-chat.controller.ts           # JWT existente, ruta, DTO y respuesta
  quiz-chat.service.ts              # autorización, contexto y coordinación
  chat-orchestrator.service.ts      # bucle del proveedor; estado por solicitud
  chat-limits.service.ts            # plazo, concurrencia y cuotas
  dto/                             # entrada HTTP y borrador validado
  contracts/                       # mensajes, herramientas y resultado
  prompts/quiz-system-prompt.ts     # instrucciones estáticas y contexto separado
  providers/deepseek.client.ts      # HTTP del proveedor, timeout y parseo
  tools/quiz-tools.catalog.ts       # JSON schemas y descripciones
  tools/quiz-tools.executor.ts      # lista permitida; sin escritura
  tools/question-draft.validator.ts
src/quizzes/
  question-batches.controller.ts
  question-batches.service.ts      # operación atómica e idempotente
  question-batch-operation.entity.ts
  quiz-write-coordinator.ts        # transacción/bloqueo compartido con CRUD
  dto/create-question-batch.dto.ts
```

`ChatbotModule` importa `QuizzesModule` y `ProfilesModule`; `QuizzesModule` exporta los servicios públicos necesarios, sin exportar repositorios al chatbot ni importar el chatbot de vuelta. El endpoint de lote pertenece a autoría, no al proveedor. Mantener métodos públicos CRUD y sus respuestas; realizar refactors pequeños con pruebas, no reescrituras.

Alternativa rechazada: colocar proveedor, prompt, persistencia y chat en `QuizzesService` o `QuizEditorPage`.

### 2. Contrato REST inicial

Tipos conceptuales compartidos por documentación, con DTOs/validación reales en backend:

```ts
type DraftQuestion = { statement: string; correctBoolean: boolean };
type QuestionDraft = { questions: DraftQuestion[] };
type QuizChatRequest = {
  messages: { role: 'user' | 'assistant'; content: string }[];
  requestedCount?: number; // entero 1..30; cantidad estructurada prioritaria
  currentDraft?: QuestionDraft; // versión editada, con preguntas retenidas
};
type QuizChatResponse = { reply: string; draft: QuestionDraft | null };
type QuestionBatchRequest = { operationId: string; questions: DraftQuestion[] };
```

- `POST /quizzes/:quizId/chat`: `200 QuizChatResponse`. Historial no vacío, último mensaje `user`, máximo 40 mensajes de 2000 caracteres, borrador de 1..30 preguntas si está presente y cuerpo de hasta 96 KiB.
- `POST /quizzes/:quizId/questions/batch`: `200 { operationId, questions }`; cada pregunta del recibo incluye `id`, `quizId`, `statement`, `correctBoolean`, `position`, `imageKey: null` y `imageUrl: null`. Enunciados normalizados con trim; booleanos sin coerción. Mismos códigos de éxito en primera ejecución y replay.
- Errores `{ code, message }` compatibles con el cliente actual: 400 `VALIDATION_ERROR`, 401/403/404 existentes, 409 `OPERATION_CONFLICT`, 413 `PAYLOAD_TOO_LARGE`, 429 `CHAT_RATE_LIMITED`, 502 `CHAT_PROVIDER_ERROR`, 503 `CHAT_NOT_CONFIGURED`, 504 `CHAT_TIMEOUT`. Mensajes seguros en español; sin payload externo ni secretos.
- `draft: null` significa «sin propuesta nueva», no «eliminar la propuesta anterior». El cliente conserva la versión local. Un nuevo borrador válido reemplaza la propuesta activa para revisión, nunca el cuestionario guardado.

No añadir posiciones, IDs persistidos, URLs ni herramientas de metadatos al borrador. La selección/exclusión es local; el cliente envía las preguntas retenidas en `currentDraft` y únicamente las seleccionadas al confirmar. El profesor puede aprobar menos que la cantidad generada. Si pide cantidad por texto, el prompt la interpreta; cuando envía `requestedCount`, el servidor exige esa longitud exacta a la propuesta generada. Una instrucción textual contradictoria requiere aclaración, no una suposición silenciosa.

Alternativa rechazada: devolver solo texto/Markdown y pedir al navegador que extraiga las preguntas.

### 3. DeepSeek y tool calling sin efectos persistidos

Usar `fetch` de Node detrás de un cliente inyectable contra `https://api.deepseek.com/chat/completions`, sin SDK o framework adicional. Modelo configurable, `thinking: { type: 'disabled' }`, `stream: false`, salida acotada y `tool_choice: 'auto'`. No copiar ciegamente el nombre de modelo antiguo del C#; el ejemplo usa `deepseek-flash`, documentado actualmente, y admite sustituirlo con configuración.

Catálogo mínimo:
- `getQuizContext({})`: lee el cuestionario con `QuizzesService` usando usuario y `quizId` fijados por el servidor; devuelve título, descripción, cantidad y un resumen acotado de preguntas, sin `ownerId`, URLs firmadas ni credenciales. Para contener tokens, envía hasta 30 enunciados existentes y marca explícitamente si el contexto fue truncado.
- `proposeQuestions({ questions })`: valida el borrador y la cantidad esperada antes de establecer el resultado estructurado de la solicitud; no persiste nada. El modelo puede volver a utilizarla para corregir la propuesta.

El orquestador agrega la respuesta `assistant` con sus `tool_calls` y devuelve cada resultado con su `tool_call_id` antes de consultar otra vez, como en C#. Mantiene estado por solicitud, admite varias herramientas ordenadas en una ronda y limita cinco rondas/20 llamadas totales. Herramientas desconocidas y argumentos inválidos devuelven errores seguros al modelo; no se ejecutan. Agotamiento o respuesta final vacía/inválida producen 502; timeout produce 504. Un borrador parcial no se entrega como éxito si falla la respuesta final.

Validar DTOs de herramientas explícitamente (`plainToInstance` + validación estricta o adaptador equivalente); llamar servicios internos no pasa por `ValidationPipe`. Los IDs y usuario del contexto nunca se aceptan como argumentos del modelo. El servidor prepara solo contexto necesario; no envía JWT, email, claves, configuración ni resultados completos con imágenes.

### 4. Prompt adaptado del proyecto C#

Referencia de lectura: `chatbot/chatbotClima/chatbotClima/Services/ChatService.cs`, `DeepSeekClient.cs`, `ToolExecutorDispatcher.cs` y sus pruebas de prompt. No modificar ese repositorio.

Mantener las secciones de identidad/propósito, TOOLS, SCOPE AND SAFETY, RESPONSE STYLE y contexto. Cambiar el dominio a autoría educativa V/F. Reglas: pedir datos faltantes, respetar cantidad y lista aportada, preguntas claras y variadas, no presentar datos inciertos como comprobados, conservar ediciones no afectadas y distinguir propuesta de guardado. Eliminar restricciones de clima/geografía, cierres meteorológicos y prohibiciones generales de matemáticas/programación.

En refinamientos, «agrega N más» es un incremento sobre `currentDraft`, no un nuevo total ni una solicitud de persistencia. Devolver todas las preguntas retenidas más las nuevas en `proposeQuestions`; conservar texto, respuestas y orden no afectados. Si el total supera 30, aclarar antes de proponer. El frontend expresa la cantidad en texto; `requestedCount` sigue siendo opcional y conserva validación exacta cuando otro cliente lo envía.

Las instrucciones estáticas del servidor se separan del contexto serializado y delimitado como datos no confiables. Se rechazan roles privilegiados enviados por cliente. La seguridad efectiva reside en autorización, catálogo de solo lectura/borrador y endpoint explícito de confirmación; no se promete inmunidad del modelo a prompt injection únicamente por el texto del prompt. Nunca mostrar razonamiento interno ni claves.

### 5. Guardado por lote, coordinación e idempotencia durable

Crear una tabla de operaciones con `userId`, `quizId`, `operationId`, hash del contenido normalizado/ordenado, recibo JSON y fecha, con unicidad de la terna y FK al cuestionario con borrado en cascada. El recibo conserva el resultado de creación aunque una pregunta se edite después; la UI recarga el detalle actual para no restaurar versiones antiguas.

Tras validar JWT/rol y entrada, ejecutar una única transacción con bloqueo de escritura de la fila `Quiz`; volver a verificar propietario dentro de ella. Comprobar una operación previa: hash igual devuelve recibo; distinto, 409. Si no existe, obtener la posición final, insertar el lote, actualizar `updatedAt` y registrar el recibo en esa misma transacción. Error revierte preguntas y registro. Canonicalizar campos permitidos con trim y orden de preguntas estable, sin incluir metadatos del navegador.

Reutilizar el mismo coordinador y orden de bloqueo (cuestionario antes que preguntas) en crear/mover/eliminar manualmente, releyendo entidades después del bloqueo. Coordinar eliminación del cuestionario con esa misma fila; no sostener transacciones durante llamadas al LLM. Mantener firmas públicas de servicios y restricciones de la base. No hacer `Promise.all(create(...))`, ni envolver transacciones independientes esperando atomicidad.

Alternativas rechazadas: idempotencia en memoria (se pierde al reiniciar), deduplicar por enunciado (impide repeticiones intencionales) y desactivar la restricción de posiciones.

### 6. Configuración, límites y pausa solicitada

`.env.example` documenta `DEEPSEEK_API_KEY=`, `DEEPSEEK_MODEL=deepseek-flash` y `DEEPSEEK_TIMEOUT_MS=60000`. La clave solo se usa en la cabecera Authorization del cliente proveedor. No hacerla obligatoria en la validación global; la ruta del chat devuelve 503 si falta. Plazo total de conversación: 90 segundos, con cada consulta limitada por el menor entre tiempo restante y timeout configurado. Sin reintentos automáticos de peticiones costosas al proveedor.

El identificador oficial `deepseek-flash` corresponde a DeepSeek V4.1 Flash según la documentación vigente y se verificó en el catálogo `/models`. No sustituirlo por un nombre comercial no aceptado por la API; el entorno local ya contiene ese identificador.

Límites iniciales de diseño: 30 preguntas, cinco solicitudes iniciadas por minuto y una activa por profesor en esta instancia, con limpieza de entradas expiradas y liberación en `finally`; 429 cuando se exceden. El despliegue actual se trata como instancia única; para varias réplicas, sustituir el limitador por almacenamiento compartido antes de prometer cuota global.

Al terminar los artifacts y el ejemplo de entorno, **detenerse**. El usuario agrega la clave en `Back-Proyecto2/.env` sin compartirla. No abrir/imprimir ese archivo para obtener el secreto ni hacer llamadas reales antes de una nueva instrucción de implementación. Las pruebas unitarias usan un proveedor simulado y nunca consumen saldo; la prueba real posterior es pequeña, sin datos sensibles y con permiso del usuario.

## Risks / Trade-offs

- [La IA puede proponer respuestas incorrectas] → revisión obligatoria y respuesta incierta aclarada; no afirmar verificación externa que no existe.
- [Refactor de bloqueo afecta autoría existente] → capturar baseline, conservar contratos y probar orden, imágenes, propiedad y copias de sesiones antes/después.
- [Guardado sin respuesta y reintento] → recibo durable y reenvío del mismo contenido/identificador; no confiar solo en deshabilitar el botón.
- [Latencia, cuotas y costo] → límites, plazos, contexto acotado y pruebas simuladas por defecto.
- [Logs o telemetría capturan información] → no registrar cabeceras/cuerpos, auditar instrumentación del cliente y redactar errores del proveedor.
- [Borradores se pierden al recargar] → comunicar que no hay historial persistente en esta versión; no prometer recuperación entre recargas.
- [Prueba previa de reinicio consume sus 15 segundos de revisión en typecheck del hijo] → usar `ts-node/register/transpile-only` solo en el harness aislado, manteniendo build/typecheck separado y todas las aserciones/plazos del juego intactos; no cargar el chatbot en ese hijo.

## Migration Plan

1. Pausar tras planificación/configuración del ejemplo de entorno; retomar solo con autorización nueva del usuario.
2. En apply, capturar baseline de unitarias/build y comprobar una BD exclusiva de pruebas antes de suites de integración/sesiones/sockets; nunca reutilizar la de desarrollo por omisión.
3. Añadir migración de operaciones y probar up/down en BD de pruebas. No ejecutar migración en la BD configurada del usuario sin avisar y obtener autorización para ese paso.
4. Implementar y verificar servicios, contratos/OpenAPI y regresiones; desplegar migración antes de exponer el endpoint de lote. No ejecutar seeds ni cambiar datos previos.
5. Integrar UI tras verificar el contrato del backend y realizar un smoke test real acotado, autorizado y sin escrituras hasta aprobar el lote.
6. Rollback: retirar UI/rutas nuevas y mantener la tabla aditiva sin uso; revertir migración únicamente de forma explícita después de comprobar que no se necesitan sus recibos. Ningún rollback debe eliminar preguntas existentes.

## References

- https://api-docs.deepseek.com/guides/tool_calls
- https://api-docs.deepseek.com/api/create-chat-completion
- https://docs.nestjs.com/modules
- https://docs.nestjs.com/techniques/validation
