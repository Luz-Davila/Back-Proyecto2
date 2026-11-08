# Verificación del asistente de cuestionarios

Cambio OpenSpec: `openspec/changes/add-quiz-chatbot`. Implementación modular en
`src/chatbot/`; guardado y bloqueo de autoría en `src/quizzes/`.

## Alcance comprobado

- Baseline unitario: 26 suites / 189 casos. Posteriormente: 30 suites / 217 casos aprobados,
  incluidos DTOs, argumentos de herramientas, permisos, JWT/HTTP, proveedor simulado,
  bucle acotado, cuotas, contexto minimizado y regresiones existentes.
- `npm run build`: aprobado; no se agregó un SDK del proveedor ni otras dependencias.
- `npm run test:integration`: dos suites / diez casos aprobados en PostgreSQL exclusivo
  de pruebas. Los lotes se prueban en un esquema aleatorio que se elimina al terminar.
  Incluye rollback tras una inserción fallida, envío concurrente, replay durable,
  conflicto de hash, rol/propiedad, orden con CRUD y migración up/down.
- `npm run test:sessions`: ocho suites / 83 casos aprobados; no se cambiaron contratos
  de partidas, puntuación, tiempos ni snapshots.
- `npm run demo:chatbot -- --live`: DeepSeek real entregó dos preguntas con booleanos
  válidos. La prueba no importa persistencia, no escribe BD y no imprime claves,
  mensajes del modelo ni el contenido de `.env`.
- `npm run demo:chatbot -- --live --refinement`: prueba real de «Agrega 2 países más»
  desde un borrador artificial de dos preguntas. Devolvió cuatro, mantuvo exactamente las
  dos afirmaciones/respuestas revisadas y no importó ni escribió persistencia.
- Se verificó en documentación oficial y `/models` que `deepseek-flash` corresponde a
  DeepSeek V4.1 Flash. El entorno local ya usaba ese identificador; se añadió una nota
  explicativa sin cambiar la clave. Referencia: https://api-docs.deepseek.com/updates
- Lint aislado de archivos nuevos: aprobado. El lint global conserva problemas de
  formato/tipos en archivos anteriores, ajenos al nuevo módulo; no se aplicó un fix global.

## Migración autorizada

El usuario autorizó expresamente aplicar `AddQuestionBatchOperations1794096000000`.
`migration:run` terminó con commit y `migration:show` confirmó las cinco migraciones
aplicadas. Se creó una tabla con RLS para recibos idempotentes. No se ejecutaron seeds,
no se guardaron lotes de demostración en la base del usuario y no se modificaron datos previos.

## Pruebas de sockets

La primera ejecución completa aprobó 85/86 casos y agotó el plazo de arranque de un hijo
de pruebas. El reintento aislado mostró que el caso REVIEW no vencido podía consumir sus
15 segundos durante el typecheck del proceso hijo. Ese hijo importa sesiones, no el chatbot.
Se cambia únicamente el harness a `ts-node/register/transpile-only`, manteniendo el build
tipado separado, las aserciones y los tiempos de la aplicación. La ejecución completa
posterior aprobó las seis suites y los 86 casos. Los mensajes de error de escenarios
de fallo controlado en esa suite no indican tests fallidos.

## Pendientes de aceptación

- La prueba de navegador con profesor real y variables públicas ya pasó: login,
  propuesta de dos preguntas editable y comprobación por API de que no hubo escrituras.
  Se agregó únicamente el origen CORS local que faltaba, sin alterar las claves del usuario.
- Pendiente de aceptación: partida manual con dos estudiantes reales. Las suites
  automáticas de sesiones/sockets y los E2E de host/participante sí pasaron.
- Las pruebas de frontera/salvaguardas son automatizadas; la revisión de calidad pedagógica
  de cada propuesta sigue siendo responsabilidad del profesor.
- Mantener los cambios OpenSpec activos hasta revisión; no se sincronizaron ni archivaron
  los specs principales automáticamente.
