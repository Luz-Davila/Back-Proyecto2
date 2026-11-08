## 1. Autorización de apply y baseline

- [x] 1.1 Retomar solo después de la pausa solicitada, con nueva autorización de implementación y confirmación del usuario de que configuró `Back-Proyecto2/.env`; verificar presencia de configuración sin imprimir valores y acordar un smoke test real pequeño, no ejecutarlo durante planificación.
- [x] 1.2 Registrar baseline de `npm test -- --runInBand`, `npm run build` y análisis estático sin `--fix`; identificar fallos previos y comprobar una BD exclusiva de pruebas antes de integración/sesiones/sockets, sin ejecutar seeds ni migraciones en desarrollo.

## 2. Contratos, módulo y configuración

- [x] 2.1 Crear contratos/DTOs pequeños para mensajes, borrador, herramientas y lote; probar con Jest cantidad 1..30, longitud 1..500, booleanos reales, UUID, roles, historial/cuerpo excesivos y rechazo de propiedades adicionales.
- [x] 2.2 Crear `ChatbotModule`, controlador delgado y autorización por profesor/propietario; exportar servicios necesarios desde `QuizzesModule` sin dependencias cíclicas; probar 401/403/404 antes del proveedor y compilación de módulos existentes.
- [x] 2.3 Implementar lectura tipada de configuración opcional y errores 503 sin afectar arranque/CRUD; comprobar las variables documentadas en `.env.example`, valores seguros y redacción de errores mediante pruebas sin claves reales.

## 3. Proveedor, prompt y herramientas

- [x] 3.1 Implementar cliente DeepSeek inyectable con HTTP simulado, modelo configurable, non-thinking, salida/plazos acotados y traducción segura de errores; probar 200, 429 externo, fallo HTTP, JSON/respuesta inválidos y timeout, sin registrar cabeceras/cuerpos.
- [x] 3.2 Adaptar el system prompt C# en archivo separado con contexto no confiable delimitado; probar estructura, español, cantidades/listas, conservación de revisiones, aclaraciones, temas educativos permitidos y ausencia de secretos/reglas meteorológicas.
- [x] 3.3 Implementar catálogo/ejecutor de `getQuizContext` y `proposeQuestions` con validación explícita y contexto fijado por servidor; probar herramienta desconocida, argumentos inesperados, cantidad incorrecta, respuesta de texto, recorte anunciado del contexto y ninguna escritura de autoría.
- [x] 3.4 Implementar orquestador con estado por solicitud, `tool_call_id`, varias herramientas ordenadas, máximo cinco rondas/20 llamadas y respuesta `{ reply, draft }`; probar corrección de argumentos, aclaración sin propuesta, respuesta vacía, agotamiento y fallos posteriores a un borrador parcial.
- [x] 3.5 Implementar cuota/concurrencia y plazo total con liberación/limpieza; probar cinco solicitudes por minuto, una activa por profesor, aislamiento entre usuarios, 429 y recuperación tras error/timeout.

## 4. Persistencia y compatibilidad de autoría

- [x] 4.1 Crear entidad/migración aditiva de operaciones idempotentes y probar up/down exclusivamente en BD de pruebas, unicidad y borrado en cascada; solicitar autorización específica antes de aplicarla en la BD del usuario.
- [x] 4.2 Extraer coordinación de escritura por cuestionario y adoptarla en operaciones manuales sin cambiar firmas/contratos; probar propiedad, inserción, orden, movimientos, eliminación, concurrencia y preservación de imágenes/copias de partidas.
- [x] 4.3 Implementar servicio/endpoint de lote con una transacción, hash canónico y recibo durable; probar rollback por fallo intermedio, contenido editado exacto, cantidad seleccionada, posiciones finales y guardado independiente de DeepSeek.
- [x] 4.4 Probar integración de doble envío concurrente, replay tras recrear/reiniciar el servicio, hash diferente 409, autorización en replay y concurrencia lote/manual; comprobar recibo histórico y detalle actual sin pérdida de cambios.

## 5. Verificación, documentación e integración

- [x] 5.1 Documentar ambas rutas/códigos/ejemplos en OpenAPI y README, configuración solo backend y límites; verificar contrato contra los fixtures del cambio frontend y revisar modularidad/tamaño de archivos nuevos.
- [x] 5.2 Ejecutar unitarias, build y análisis estático; ejecutar integración/sesiones/sockets únicamente con BD de pruebas segura y comparar contra baseline, incluyendo CRUD, imágenes, aislamiento y snapshots de partidas. Informar cualquier suite bloqueada, no declararla aprobada.
- [x] 5.3 Tras autorización, realizar smoke test real acotado de generación/revisión con DeepSeek y confirmar que no se guardan preguntas; acordar separadamente la escritura de un lote de prueba y su limpieza antes de hacerla. Nunca mostrar claves, JWT ni payloads sensibles.
- [x] 5.4 Revisar resultados con el cambio `add-quiz-chatbot-ui`, validar OpenSpec y mantener specs principales sin sincronizar/archivar hasta que implementación y pruebas estén aprobadas.

## 6. Refinamiento incremental y modelo Flash

- [x] 6.1 Explicitar en prompt/catálogo que «agrega 2 países más» amplía el borrador completo manteniendo correcciones; cubrir contexto/herramienta sin escrituras y límites.
- [x] 6.2 Documentar DeepSeek V4.1 Flash mediante `DEEPSEEK_MODEL=deepseek-flash`, verificado en docs y catálogo, sin exponer claves. Validar tests/build/OpenSpec y prueba real acotada de refinamiento sin persistencia.

## Evidencia y pendientes de verificación

- Baseline: 189 unitarias. Build inicial agotó el tiempo; build posterior y typecheck pasan. Lint global presenta errores de formato/tipos en archivos previos; el lint aislado del código nuevo pasa sin deshabilitar reglas.
- Resultado final del refinamiento: 217 unitarias, build y lint aislado aprobados. Las ejecuciones anteriores de 10 pruebas de integración, 83 de sesiones y 86 de sockets permanecen documentadas; no se repitieron por este ajuste de prompt/configuración sin cambios en persistencia/juego. Sockets presentó inicialmente timeout/vencimiento de revisión durante typecheck del hijo; al evitar esa compilación repetida solo en el harness, la suite completa pasó sin cambiar aplicación, plazos ni aserciones.
- Smoke real `npm run demo:chatbot -- --live`: dos preguntas válidas, cero escrituras, sin imprimir contenido ni credenciales. No se guardaron lotes de ejemplo en la base del usuario.
- Refinamiento real `npm run demo:chatbot -- --live --refinement`: dos afirmaciones retenidas intactas más dos países nuevos, cuatro en total, booleanos válidos y cero escrituras. Modelo local verificado: `deepseek-flash`, alias oficial de V4.1 Flash.
- El usuario autorizó expresamente la migración; `AddQuestionBatchOperations1794096000000` aplicada y confirmada con `migration:show`.
