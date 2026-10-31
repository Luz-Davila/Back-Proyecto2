## Purpose

Observar comandos, respuestas, recuperación y retrasos del motor con métricas verificables, de cardinalidad acotada y sin condicionar la partida a un servicio de monitoreo externo.

## ADDED Requirements

### Requirement: Catálogo verificable de métricas del juego

El servicio SHALL exponer mediante su canal de telemetría configurable los contadores `profelink.game.commands`, `profelink.game.answers`, `profelink.game.recovery.requests` y `profelink.game.notification.failures`, los histogramas en segundos `profelink.game.command.duration`, `profelink.game.queue.wait` y `profelink.game.deadline.lag`, y el gauge `profelink.game.connections`. SHALL documentar tipo, unidad, alcance, punto de medición y atributos de cada instrumento. commands SHALL contar una vez cada comando Socket.IO con callback procesado, incluidos rechazos de autenticación/validación y nombres no soportados normalizados; los mensajes sin callback descartados y handshakes no aceptados no SHALL contarse como comandos ejecutados. connections SHALL representar sockets autenticados conectados, no usuarios únicos, participantes históricos ni capacidad máxima.

#### Scenario: Comando exitoso o rechazado
- **WHEN** se procesa un comando con callback y termina en éxito, conflicto de dominio, validación, autenticación o error inesperado
- **THEN** se registra una sola observación de comando y duración con resultado y código acotados, sin repetir el ack ni cambiar su shape

#### Scenario: Múltiples dispositivos
- **WHEN** una cuenta tiene dos sockets autenticados y uno se desconecta
- **THEN** el gauge de conexiones pasa de dos a uno sin afirmar que existen dos jugadores ni eliminar su participación

### Requirement: Contadores confirmados e idempotencia observable

answers SHALL distinguir `accepted`, `replayed`, `rejected` y `error` para invocaciones que alcanzan el servicio de respuestas; los rechazos previos de transporte SHALL quedar en commands y no fingir admisión de dominio. Una respuesta nueva SHALL contarse accepted solo tras commit; un reintento idempotente SHALL contarse replayed y no accepted. Reintentos internos de transacción no SHALL multiplicar observaciones de una misma invocación. recovery.requests SHALL distinguir consulta/recuperación exitosa de incorporación inicial y rechazo/error para GET por código, room:join y room:subscribe. Fallar una entrega después de commit no SHALL deshacer el conteo confirmado ni repetir puntuación; SHALL observarse por separado como fallo de notificación. Estos contadores SHALL documentarse como observabilidad de proceso, no libro contable durable ni reconstrucción de todo el historial.

#### Scenario: Respuesta repetida
- **WHEN** se acepta una respuesta y la misma cuenta la reenvía dos veces
- **THEN** se observa un accepted y dos replayed, con una sola Answer y sin sumar otra vez

#### Scenario: Rollback o recuperación de colisión única
- **WHEN** falla una transacción de aceptación o se reintenta internamente tras una colisión única
- **THEN** no se registra accepted por una escritura revertida y el resultado final de la invocación se cuenta una sola vez

#### Scenario: Incorporación inicial frente a recuperación
- **WHEN** una cuenta entra por primera vez en WAITING y luego recupera el mismo participante por otra conexión
- **THEN** se distinguen creación inicial y recuperación, sin presentar la primera como recuperación exitosa ni el segundo acceso como jugador nuevo

### Requirement: Duraciones y retrasos sin alterar el reloj de juego

command.duration SHALL medir desde la recepción del comando con callback hasta preparar su ack en el servidor, incluyendo autenticación, validación, cola, dominio y proyección aplicables, sin atribuirle latencia de red del cliente. queue.wait SHALL medir espera hasta obtener el turno local de sala. Las duraciones de comando y espera SHALL usar una fuente monotónica y no el reloj de pruebas/fechas del juego. deadline.lag SHALL registrar `max(0, instante de ejecución autoritativa - deadline esperado)` solo cuando el trabajo produce una transición efectiva, distinguiendo ANSWER y REVIEW; un plazo obsoleto no SHALL contarse como transición. La instrumentación no SHALL retrofechar respuestas, extender ventanas ni decidir reglas.

#### Scenario: Cola lenta
- **WHEN** una proyección anterior demora el turno de un comando
- **THEN** su espera y duración reflejan la demora mientras la admisión y el bono siguen usando el reloj autoritativo bajo exclusión

#### Scenario: Worker atrasado y trabajo obsoleto
- **WHEN** se procesa un deadline atrasado y después se repite el mismo trabajo
- **THEN** se registra el retraso de la transición efectiva una sola vez y el no-op no inventa otra observación de cierre

### Requirement: Privacidad y cardinalidad acotada

Los instrumentos del juego SHALL usar únicamente atributos de catálogos finitos documentados para operación, resultado, código, canal, fase de deadline o etapa de notificación. No SHALL usar JWT, credenciales, email, payload, choice, solución, SQL, URL completa, código de sala, sessionId, participantId, userId, socketId, streamId ni texto de error como etiquetas. Nombres de evento arbitrarios y errores desconocidos SHALL normalizarse a valores acotados. La configuración/documentación SHALL advertir y evitar que la instrumentación automática añadida al escenario capture consultas SQL con valores, cabeceras Authorization, query strings sensibles o rutas HTTP concretas con códigos como etiquetas de métricas.

#### Scenario: Eventos y errores arbitrarios
- **WHEN** llegan nombres de evento diferentes no soportados o fallos con mensajes únicos
- **THEN** las métricas usan valores normalizados sin crear una serie por mensaje ni revelar el contenido

#### Scenario: Exportación revisada localmente
- **WHEN** se inspeccionan las observaciones de una prueba con dos salas y varias identidades
- **THEN** no aparecen identificadores, tokens, elecciones ni datos de solución en atributos del catálogo de juego

### Requirement: Telemetría opcional y validación sin Grafana

La aplicación SHALL conservar el funcionamiento sin endpoint de exportación y ante fallos del exportador. No SHALL esperar una conexión de Grafana ni hacer que su disponibilidad determine acks, commits o transiciones. SHALL existir una comprobación local de instrumentos, valores y atributos mediante un receptor/exportador controlado, y documentación del canal de exportación para conexión futura. No SHALL exigirse crear una cuenta, dashboard o despliegue de Grafana para aprobar estas pruebas; esa integración SHALL declararse diferida hasta verificarse realmente. Al cerrar el proceso se SHALL liberar lectores, callbacks y recursos de métricas sin acumular listeners entre pruebas.

#### Scenario: Servicio externo ausente
- **WHEN** no se configura exportación o el receptor deja de responder
- **THEN** las mismas operaciones del juego mantienen contratos y atomicidad, y el fallo no se devuelve como error de negocio

#### Scenario: Prueba local y cierre
- **WHEN** se ejecuta una secuencia conocida con un exportador controlado y se cierra la aplicación
- **THEN** se verifican contadores, histogramas y gauge sin cuenta externa, y no quedan recursos de telemetría abiertos
