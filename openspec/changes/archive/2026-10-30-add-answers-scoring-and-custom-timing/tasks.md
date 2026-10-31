## 1. Contratos y límites de configuración

- [x] 1.1 Definir rangos/defaults de respuesta 5–120/30 y revisión 3–15/5, reemplazando el tipo limitado a 15|30 sin cambiar los campos de SessionState REST.
- [x] 1.2 Adaptar CreateSessionDto/servicio para aceptar ambos tiempos opcionales, aplicar defaults solo a undefined y rechazar texto, null, booleanos, decimales y propiedades extra.
- [x] 1.3 Definir AnswerReceipt y DTO estricto de answer:submit, con solo sessionQuestionId y choice, conservando el contrato uniforme de callback ack.
- [x] 1.4 Definir el envelope de ocho campos, filas de scoreboard y scoreboard:updated; registrar explícitamente que answer:ack es callback y no un evento adicional.

## 2. Persistencia y migración conservadora

- [x] 2.1 Agregar reviewDurationSeconds a GameSession y scoredAt interno a SessionQuestion; mantener restricciones únicas existentes y no imponer un CHECK de scores que invalide historial.
- [x] 2.2 Crear migración nueva transaccional para respuesta 5–120, revisión default 5 con CHECK 3–15 y marca de puntuación; no editar migraciones previas ni recapturar quizzes.
- [x] 2.3 Incorporar preflight bajo bloqueo para abortar ante IN_PROGRESS o WAITING con preguntas jugadas/respuestas; backfill solo metadatos de cierres finalizados sin tocar respuestas, scores, resultados ni reservas.
- [x] 2.4 Implementar down con preflight seguro: abortar ante partidas en curso o duraciones incompatibles con 15/30, sin convertir valores ni borrar historial; revertir solo cuando sea compatible.
- [x] 2.5 Probar up/down, defaults, CHECKs, preflight sin cambios parciales, backfill e historial con puntajes heredados en PostgreSQL exclusivo de pruebas.

## 3. Aceptación autoritativa de respuestas

- [x] 3.1 Crear el servicio de respuestas con resolución por SessionQuestion y revalidación de sala/participante bajo el mismo locked/EntityManager del dominio; no añadir reglas al Gateway ni locks anidados.
- [x] 3.2 Implementar precedencia de autorización y errores: ajeno/inexistente, host propio, respuesta existente, deadline, sala finalizada, pregunta actual OPEN y openedAt.
- [x] 3.3 Asignar answeredAt desde SessionClock al admitir bajo exclusión e insertar una única Answer con score inicial no divulgado, sin usar timestamps ni identidad del cuerpo.
- [x] 3.4 Implementar mismo choice → comprobante original y distinto → ANSWER_ALREADY_SUBMITTED, incluso en REVIEW, pregunta posterior o FINISHED, sin modificar registro/score ni publicar transiciones.
- [x] 3.5 Incorporar la respuesta insertada a la evaluación de participación completa dentro de la misma transacción, sin llamar un segundo método que tome el bloqueo de sala.
- [x] 3.6 Mantener unicidad de BD como defensa final y recuperar de su colisión específica mediante rollback/revalidación acotada en transacción nueva, sin capturar errores SQL ajenos como duplicados.
- [x] 3.7 Probar lógica de pertenencia, comprobante exacto, límites de tiempo, pregunta anterior/futura/cerrada, cambio de elección y respuesta tardía antes de que actúe el worker.

## 4. Cierre y adjudicación de puntos

- [x] 4.1 Implementar política pura de puntuación de respuestas aceptadas contra el snapshot: 0 por error, 1 por acierto y 3 por menor answeredAt correcto en [openedAt, openedAt+3000ms), con todos los empates exactos.
- [x] 4.2 Unificar cierre por última respuesta, plazo, evaluación interna y finish anticipado para persistir closedAt, reviewEndsAt configurable, scores y scoredAt juntos y no repuntuar si ya existe la marca.
- [x] 4.3 Extender persistencia de los scores con el mismo manager/transacción; asegurar rollback de inserción final, cierre, puntuación, resultados y liberación de reserva ante fallos.
- [x] 4.4 Usar la revisión configurada en avance automático/manual y procesamiento de plazos existentes; mantener protección por pregunta esperada y no acortar respuesta/revisión.
- [x] 4.5 Derivar resultados finales de puntajes confirmados, sin totalScore incremental, con ceros, host excluido y clasificación densa; preservar resultados históricos ya finalizados.
- [x] 4.6 Probar bono en 0/2999/3000 ms, error primero, ausencia de acierto rápido, empates, omisiones, cierre repetido, fin en cada fase y pregunta nunca abierta sin aportar puntos.

## 5. Clasificación y publicación segura

- [x] 5.1 Crear proyector de scoreboard con filas exactas, ceros para todos los jugadores, orden estable y puestos densos, sumando solo preguntas cerradas/puntuadas; en FINISHED usar resultados persistidos.
- [x] 5.2 Agregar scoreboard y reviewDurationSeconds solo al envelope WS, manteniendo REST/OpenAPI de estado con los campos existentes y sin respuestas individuales ni marcador interno.
- [x] 5.3 Ampliar metadatos del commit para distinguir nuevas puntuaciones, incluso cuando el total no cambia; mantener secuencia sin cambios en inserciones intermedias, consultas y reintentos idempotentes.
- [x] 5.4 Publicar room:state, evento de pregunta si aplica, scoreboard:updated si aplica y game:finished al final, compartiendo proyección/stream/secuencia y sin revisión artificial al finalizar.
- [x] 5.5 Conservar aislamiento, revocaciones y acceso JWT vigente para el evento nuevo; mantener fallo posterior al commit recuperable sin repetir puntuación ni bloquear el comprobante privado por una nueva firma de imagen.
- [x] 5.6 Probar que scoreboard no revela aciertos durante OPEN, se actualiza una vez por cierre aun con ceros, se recupera por suscripción actual y coincide con resultados finales sin reinterpretar historial.

## 6. Integración de Gateway y pruebas concurrentes

- [x] 6.1 Habilitar answer:submit en el dispatcher existente, autenticado y con callback obligatorio; no registrar endpoint REST ni evento de nombre answer:ack y conservar errores uniformes sin stack/SQL.
- [x] 6.2 Probar con sockets reales cuerpos inválidos, acceso vencido, host, sala ajena e intentos de userId/participantId/score/answeredAt; comprobar que solo el solicitante recibe su comprobante y no se filtran soluciones/puntajes OPEN.
- [x] 6.3 Probar doble clic y dos dispositivos con igual elección: mismo id/answeredAt y una fila; elecciones distintas concurrentes: una ganadora y un conflicto sin sobrescritura.
- [x] 6.4 Probar ack perdido y recuperación del comprobante tras cierre y FINISHED usando JWT vigente, sin registros/scores/secuencias/events extra; no agregar el endpoint del paso 7.
- [x] 6.5 Probar respuesta en carrera con deadline, última respuesta con cierre, y finish/avance/temporizadores concurrentes usando conexiones independientes y reloj controlado, sin duplicar sumas ni saltar preguntas.
- [x] 6.6 Inyectar fallos al guardar scores/resultados y al publicar para verificar rollback atómico o recuperación posterior al commit; comprobar que se puede liberar y volver a usar la cola.
- [x] 6.7 Ejecutar dos salas con elecciones, tiempos y ganadores distintos; verificar que aceptación, bonus, scoreboard y todos los broadcasts permanecen aislados por sessionId.
- [x] 6.8 Probar tiempos custom extremos/defaults, revisión sin host, recuperación ya existente de un plazo atrasado y cola/firma lenta sin ampliar deadlines ni usar tiempos del cliente; no declarar capacidad máxima con estas pruebas funcionales.

## 7. Documentación y compatibilidad

- [x] 7.1 Actualizar OpenAPI de creación con rangos/defaults y pruebas de schema/campos, manteniendo válidos cuerpos antiguos 15/30 y shape de estado REST.
- [x] 7.2 Documentar README con contrato privado de respuesta, errores/precedencia, recuperación de comprobante, fórmula/empates/frontera del bono, clasificación tras cierre y cambio de envelope para frontend.
- [x] 7.3 Documentar migración/preflight/rollback, limitación de latencia y pendientes explícitos de pasos 7 y 8: endpoint por código, recuperación ampliada, demo de reinicio, Grafana y máximo concurrente medido.

## 8. Verificación final

- [x] 8.1 Ejecutar build, unitarias y lint sobre archivos afectados sin relajar reglas ni descartar trabajo previo; registrar resultados reales y advertencias.
- [x] 8.2 Ejecutar sesiones, Socket.IO con detección de handles abiertos, integración y e2e únicamente en TEST_DATABASE_URL local, sin fallback a desarrollo/producción ni declarar omisiones como aprobadas.
- [x] 8.3 Revisar cobertura de cada escenario de las cinco specs, preservar fixtures históricos/adaptar casos de contrato cambiados, validar OpenSpec estricto y registrar límites de las pruebas sin inventar resultados de carga o despliegue.

## Resultados de aceptación

Ver [verification.md](verification.md): 319 pruebas aprobadas (167 unitarias, 78 sesiones,
68 sockets con detección de handles, 5 integración y 1 e2e), build/lint/formato y validación
estricta satisfactorios. Incluye matriz de escenarios, incidencia intermedia de timeouts
y límites explícitos; no se midió carga ni se desplegó en producción.
