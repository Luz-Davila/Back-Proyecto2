## 1. Referencia y pruebas reproducibles

- [x] 1.1 Incorporar un resumen sanitizado de los cuatro diagnósticos previos en documentación del proyecto, diferenciando integridad correcta de cumplimiento del presupuesto de 8 s y sin atribuir una revisión Git retroactiva no registrada.
- [x] 1.2 Promover el ejecutor/perfilador temporal a utilidades TypeScript de pruebas que usen el harness local existente, registren revisión/dirty, parámetros, concurrencia, consultas/filas y limpien solo sus esquemas y procesos.
- [x] 1.3 Añadir un comando opt-in y límites explícitos para los casos 30×3, 30×30 y controles de dos preguntas con 20/50 ms por consulta; mantener los stubs locales y ningún tráfico a servicios remotos.
- [x] 1.4 Añadir regresiones deterministas inicialmente fallidas para admisión antes del plazo con procesamiento posterior, no reescritura de puntajes previos y ausencia de snapshots completos en respuestas normales.

## 2. Persistencia diferencial del ciclo de vida

- [x] 2.1 Reutilizar el agregado obtenido bajo exclusión para las mutaciones de ciclo de vida, manteniendo una copia previa inmutable para deltas y eventos y eliminando su lectura interior redundante.
- [x] 2.2 Calcular cambios reales de sala/preguntas y preguntas recién calificadas por transición de scoredAt; no persistir operaciones no-op ni volver a escribir respuestas de preguntas cerradas.
- [x] 2.3 Escribir los distintos puntajes nuevos en un lote parametrizado por pregunta y conservar en la misma transacción cambios de estado, resultados finales y liberación de membresías.
- [x] 2.4 Verificar con PostgreSQL real avances sin UPDATE de puntajes, finalización sin recalificación, cierre con todos incorrectos, rachas y rollback durante el lote sin notificaciones de éxito.

## 3. Ruta corta de respuestas

- [x] 3.1 Crear la lectura selectiva de sala/pregunta/participante/respuesta propia con bloqueo de sala, sin historial completo y conservando precedencia de pertenencia y error específico del host.
- [x] 3.2 Implementar inserción con RETURNING y conteos correctos de participación válida, combinándolos con el snapshot de PostgreSQL sin perder la fila recién insertada ni contar un conflicto dos veces.
- [x] 3.3 Integrar la ruta normal y de replay sin snapshots públicos; cargar un agregado solo cuando la respuesta nueva completa la pregunta y aplicar cierre/puntuación/notificación atómicos con persistencia diferencial.
- [x] 3.4 Conservar la restricción única y recuperación en una transacción nueva para colisiones, comprobantes originales en replay y rechazo de una elección distinta, también con cuatro opciones y después de finalizar.
- [x] 3.5 Cubrir conteo 29→30, últimas respuestas simultáneas, exclusión del host/respuestas ajenas, índices válidos alternativos y rollback de última respuesta; verificar que ninguna elección privada se publique antes de cerrar.

## 4. Admisión temporal y coordinación de cierres

- [x] 4.1 Registrar sin await una admisión por pregunta con secuencia y fecha del reloj del servidor al entrar el comando autenticado/validado al servicio, antes de BD/colas; no añadir campos de tiempo al DTO público.
- [x] 4.2 Compartir la resolución inmutable pregunta→sala entre tickets activos, manteniendo autorización transaccional y eliminación de referencias/caché al vaciarse el trabajo.
- [x] 4.3 Coordinar los trabajos automáticos ANSWER/REVIEW con las admisiones de la pregunta esperada antes de tomar el turno de sala, respetando el orden pregunta→sala y evitando reencolar el cierre interno de la última respuesta.
- [x] 4.4 Validar/persistir answeredAt desde la admisión confiable para respuestas nuevas; conservar el recibo en replay, la referencia de rapidez/empates con esa fecha, la fórmula de rachas y la terminalidad de CLOSED/FINISHED.
- [x] 4.5 Probar admisión antes/exactamente/después del cierre, resolución de sala demorada, deadline concurrente, error de autorización, rollback, finalización manual ganadora y dos salas sin bloqueo global.
- [x] 4.6 Verificar liberación en finally y shutdown sin promesas/listeners abandonados; cubrir reinicio con una admisión sin commit y recuperación exclusiva de respuestas realmente persistidas.

## 5. Observabilidad y presupuestos estructurales

- [x] 5.1 Ajustar la medición de espera a las etapas de admisión y sala sin doble conteo; conservar contadores por commit, fuente monotónica, atributos acotados y funcionamiento sin exportador.
- [x] 5.2 Añadir aserciones de consultas para respuestas normales/replay independientes del historial: cero snapshots completos y como máximo ocho sentencias por envío normal, con objetivo de cuatro dentro de la sección crítica.
- [x] 5.3 Comprobar que una partida completa actualiza como máximo 900 filas de puntajes en 30 lotes nuevos y que avances/finalizaciones sin nuevo cierre no vuelven a escribirlos.

## 6. Validación local y entrega de evidencia

- [x] 6.1 Auditar el aislamiento de los harnesses antes de correr suites con BD; adaptar el contexto de pruebas si alguna limpieza afectaría tablas/esquemas ajenos, sin usar DATABASE_URL como fallback.
- [x] 6.2 Ejecutar build, pruebas unitarias y suites locales de integración, sesiones y Socket.IO afectadas; comprobar contratos de errores, eventos/streams, seguridad, desconexión/refresh, reconexión e históricos.
- [x] 6.3 Ejecutar después de las suites el benchmark normal 30×30 y los controles 20/50 ms, sin otras cargas, con al menos dos ejecuciones por configuración y sin cambiar el presupuesto cliente de 8.000 ms.
- [x] 6.4 Contrastar 900 respuestas únicas/30 resultados, elecciones y puntuación esperadas, menos de 10.000 sentencias perfiladas y los límites de lotes/snapshots; reportar por separado todo incumplimiento de integridad o latencia y no declarar capacidad productiva.
- [x] 6.5 Documentar comandos portables, comparación antes/después y límites de la política temporal de una instancia; verificar que solo se limpiaron recursos propios y no quedaron datos sensibles en artefactos.
- [x] 6.6 Validar el cambio OpenSpec y revisar el diff completo; dejar aplicación y evidencia listas para revisión, sin push, despliegue, sincronización de specs principales ni archivo automático del cambio.
