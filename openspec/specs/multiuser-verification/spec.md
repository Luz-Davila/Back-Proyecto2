# multiuser-verification Specification

## Purpose

Demostrar recuperación y corrección multiusuario con ejecuciones reproducibles y evidencia real, diferenciando pruebas locales, dispositivos físicos y el mayor nivel concurrente efectivamente evaluado.

## Requirements

### Requirement: Escenario reproducible de dos salas y varias identidades

SHALL existir un ejecutor documentado con clientes Socket.IO reales y acceso HTTP que opere al menos dos salas simultáneas, con hosts e identidades de jugadores diferentes y tiempos configurables. SHALL verificar respuesta válida, duplicada, tardía, sin permiso, última respuesta, aislamiento de eventos/puntajes, avance y finalización. SHALL distinguir rechazo esperado de fallo inesperado y validar los invariantes de dominio además de contar acks. Los tests automatizados SHALL usar exclusivamente una BD local de pruebas distinta de desarrollo/producción, sin fallback, y credenciales/firmas de prueba; SHALL limpiar solo recursos propios incluso al fallar.

#### Scenario: Dos salas paralelas
- **WHEN** jugadores de dos salas contestan, se desconectan o finalizan simultáneamente
- **THEN** no se mezclan participantes, respuestas, bonificaciones, deadlines, secuencias ni broadcasts entre salas

#### Scenario: Duplicados y errores esperados
- **WHEN** el escenario envía la misma elección desde dos sockets, otra elección del mismo participante, una respuesta tardía y un control de host desde un jugador
- **THEN** verifica fila única, comprobante estable y códigos de error esperados sin clasificar esos rechazos deliberados como fallos inesperados de capacidad

### Requirement: Evidencia de reconexión y reinicio real local

La comprobación SHALL desconectar un jugador con puntaje confirmado y recuperarlo con la misma identidad mediante GET por código y room:join, contrastando participantId, joinedAt, respuestas, puntos y conteos persistidos. SHALL incluir detener y volver a iniciar un proceso backend local distinto conservando la misma BD, no solo recrear un worker o cambiar el reloj en memoria. SHALL cubrir caída durante ANSWERING y REVIEW y recuperación cuando los plazos están vigentes o ya vencieron. SHALL conservar la política existente de deadlines: no pausar por desconexión, no reabrir, abrir como máximo la siguiente pregunta con tiempo completo al recuperar y no reproducir soluciones históricas. El nuevo proceso SHALL emitir un streamId nuevo; los puntos previos SHALL permanecer y el cierre pendiente SHALL puntuar una sola vez. Una prueba de apagado controlado no SHALL presentarse como demostración de pérdida abrupta de energía o de reinicio del VPS.

#### Scenario: Jugador reconecta con puntaje
- **WHEN** un jugador acumula puntos, se desconecta y recupera por código con la misma cuenta
- **THEN** se muestran mismo participante y puntos confirmados actuales sin nueva fila de jugador ni respuestas duplicadas

#### Scenario: Reinicio antes del deadline
- **WHEN** se reinicia el proceso local durante una pregunta cuyo deadline todavía no venció
- **THEN** persiste la misma pregunta y su deadline, el cliente recibe un stream nuevo y no obtiene una ventana nueva de respuesta

#### Scenario: Reinicio con respuesta o revisión vencida
- **WHEN** el nuevo proceso arranca con el deadline de respuesta o revisión vencido
- **THEN** recupera la transición válida sin saltar preguntas nunca presentadas, conserva el acumulado y no repuntúa cierres confirmados

### Requirement: Reporte real del nivel concurrente probado

El ejecutor SHALL aceptar niveles y duración acotados y presupuestos explícitos de timeout/latencia, registrar los parámetros efectivos antes de evaluar el resultado y detener la progresión según sus límites. SHALL producir un reporte legible y estructurado con fecha, revisión del código o estado dirty, entorno, backend/BD/harness y dependencias simuladas, número de salas, jugadores únicos, sockets objetivo y simultáneos observados, duración, comandos, rechazos esperados, errores inesperados, timeouts, latencias cliente de ack p50/p95/p99 y comprobaciones de integridad. SHALL separar esas latencias de las duraciones internas de servidor. Recursos no medidos SHALL declararse no disponibles, no inventarse. Solo SHALL reportar como mayor nivel aprobado uno efectivamente ejecutado con concurrencia observada suficiente, presupuestos satisfechos e invariantes correctos; si no hay ninguno SHALL indicarlo. No SHALL llamarlo máximo productivo ni extrapolar a hardware, Auth, Storage o red no probados.

#### Scenario: Nivel aprobado y nivel fallido
- **WHEN** un nivel ejecutado satisface los criterios y otro posterior presenta timeouts, baja concurrencia observada o corrupción de invariantes
- **THEN** el reporte conserva ambas evidencias y no declara aprobado el segundo por haber solicitado más conexiones

#### Scenario: Sin ejecución o sin medición
- **WHEN** el ejecutor no se ha corrido o no se recogió una medición requerida
- **THEN** se registra pendiente/no disponible y no se publica un número concurrente exitoso ficticio

### Requirement: Guía manual y diferidos explícitos

La entrega SHALL incluir pasos reproducibles para varios dispositivos físicos, JWT de cuentas de prueba distintas, dos salas, recuperación y comprobación del puntaje; SHALL separar pestañas/sockets simulados de dispositivos físicos. SHALL incluir un runbook de reinicio de una instancia con la misma BD, límites de recuperación y autorización previa para intervenir un VPS. Cada ejecución externa SHALL registrarse como pendiente, ejecutada con evidencia o fallida. La creación de cuenta, conexión y dashboards de Grafana, la demo física y la intervención en VPS SHALL permanecer pendientes si no se ejecutaron; preparar instrucciones o exportar métricas localmente no SHALL acreditarlas como completadas.

#### Scenario: Solo demostración automatizada local
- **WHEN** se verifican clientes simulados y exportación local sin dispositivos físicos ni Grafana
- **THEN** el reporte distingue lo aprobado localmente de la demo física, VPS y Grafana pendientes

#### Scenario: Operador ejecuta después la guía
- **WHEN** se autoriza y realiza una demostración física o de reinicio en su entorno
- **THEN** se adjuntan fecha, entorno y resultados reales sin alterar retroactivamente lo que probaron las ejecuciones locales anteriores

### Requirement: Verificación reproducible de rendimiento y admisión de respuestas

SHALL existir una prueba opt-in que ejecute 30 identidades distintas con clientes Socket.IO reales contra el backend y una BD PostgreSQL local exclusiva de pruebas, sin navegador, JWT remotos, chatbot, Storage externo ni exportadores requeridos. SHALL completar un cuestionario de 30 preguntas con 900 envíos, mezclando booleanas, cuatro opciones con una válida y cuatro opciones con varias válidas. SHALL comprobar filas únicas, fechas autoritativas, resultados y clasificación de los 30 jugadores, conteos de aciertos/errores/omisiones, rachas y conservación de puntajes cerrados; contar acks no SHALL sustituir esas comprobaciones. Los casos de conflictos, retrasos deliberados, rollback y dos salas SHALL mantenerse además de la carga exitosa.

#### Scenario: Partida completa de 30 por 30
- **WHEN** se ejecuta la prueba normal con 30 identidades y 30 preguntas
- **THEN** se confirman exactamente 900 respuestas únicas, 30 participantes y 30 resultados, con elecciones y puntajes coherentes y sin rechazos inesperados

#### Scenario: Tipos de pregunta y rachas
- **WHEN** se mezclan elecciones booleanas, índices correctos alternativos y errores con secuencias de aciertos
- **THEN** se conserva la corrección por tipo, la aceptación de cualquiera de las opciones válidas y la fórmula de bono/racha existente

### Requirement: Presupuestos explícitos y comparación sin extrapolación

El ejecutor SHALL declarar antes de cada caso un presupuesto de ack cliente de 8.000 ms y una ventana de respuesta de 30 s, medir acks y tiempos internos por separado y producir p50/p95/p99/máximo, consultas por fase, espera de coordinación, escrituras de puntajes y concurrencia observada. SHALL comparar una referencia local sin retardo con controles de 20 y 50 ms artificiales por consulta. Los controles iniciales SHALL jugar exactamente dos preguntas de un cuestionario de 30, declarar sus 60 envíos previstos y cerrarse después; no SHALL presentarse como ejecuciones de 900 respuestas. Un caso SHALL aprobar solo con integridad correcta, cero rechazos inesperados, cero timeouts y cero acks superiores a su presupuesto; los fallos anteriores SHALL conservarse como evidencia y no sustituirse por un timeout más alto. El retardo artificial SHALL identificarse como simulación y no como latencia real de Railway, ni el nivel local como garantía productiva.

#### Scenario: Retardo controlado después de optimizar
- **WHEN** se ejecutan controles de 20/50 ms en el entorno declarado con admisiones válidas anteriores al plazo
- **THEN** se verifica el resultado de las 60 respuestas y su presupuesto de ack, manteniendo separado cualquier fallo de rendimiento de una pérdida incorrecta por cola

#### Scenario: Medición que supera el presupuesto
- **WHEN** un caso guarda todas las respuestas pero algún ack supera 8.000 ms
- **THEN** la integridad se reporta correcta pero el caso no se declara aprobado para el presupuesto del frontend

#### Scenario: Fecha de admisión frente a procesamiento
- **WHEN** una prueba determinista mantiene una respuesta en espera hasta después de su deadline y registra ambas fechas del servidor
- **THEN** demuestra aceptación según la admisión previa y rechazo en el límite exacto, sin usar timestamps del cliente ni depender de un benchmark lento para probar la regla

### Requirement: Recursos de prueba aislados y evidencia portable

El ejecutor SHALL rechazar BD no locales o coincidentes con desarrollo/producción, migrar únicamente recursos propios y limpiar solo esos recursos incluso al fallar. SHALL guardar revisión Git y estado dirty, versiones, parámetros efectivos, límites, dependencias simuladas, resultados de integridad y métricas sanitizadas en formatos legible y estructurado. No SHALL guardar contraseñas, JWT, claves, SQL con valores ni datos de otras partidas. El informe anterior a la optimización SHALL conservar su condición de referencia y no atribuirle mediciones recogidas después. Pruebas de despliegue, hardware separado o múltiples réplicas SHALL declararse pendientes mientras no se autoricen y ejecuten.

#### Scenario: Reproducción desde el repositorio
- **WHEN** otra persona configura exclusivamente la BD local de pruebas y ejecuta el comando documentado
- **THEN** obtiene casos y presupuestos equivalentes sin rutas temporales personales, sin servicios remotos y con limpieza de los recursos propios

#### Scenario: Error o interrupción
- **WHEN** falla una aserción, una conexión o la ejecución se interrumpe
- **THEN** se conserva evidencia parcial del fallo y se cierran sockets/procesos y recursos propios sin borrar tablas o esquemas ajenos
