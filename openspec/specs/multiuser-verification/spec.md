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
