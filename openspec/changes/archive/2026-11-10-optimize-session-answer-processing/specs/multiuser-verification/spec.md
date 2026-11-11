## ADDED Requirements

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
