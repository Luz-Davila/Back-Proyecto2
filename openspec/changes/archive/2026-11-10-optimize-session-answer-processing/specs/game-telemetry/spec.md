## MODIFIED Requirements

### Requirement: Duraciones y retrasos sin alterar el reloj de juego

command.duration SHALL medir desde la recepción del comando con callback hasta preparar su ack en el servidor, incluyendo autenticación, validación, admisión, coordinación, dominio y proyección aplicables, sin atribuirle latencia de red del cliente. queue.wait SHALL medir la espera efectiva hasta ejecutar el trabajo de respuesta o transición en la instancia, incluyendo sus etapas de coordinación sin duplicar una misma espera ni omitir la espera anterior al bloqueo de sala. Las duraciones SHALL usar una fuente monotónica separada de las fechas autoritativas de admisión y del reloj de pruebas del juego. deadline.lag SHALL registrar `max(0, instante de ejecución autoritativa - deadline esperado)` solo cuando el trabajo produce una transición efectiva, distinguiendo ANSWER y REVIEW; un plazo obsoleto no SHALL contarse como transición. La instrumentación SHALL NOT asignar timestamps de respuesta, extender ventanas ni decidir la partida; admisión y rapidez SHALL usar la fecha autoritativa definida por `game-answers`, independiente de la telemetría.

#### Scenario: Cola lenta
- **WHEN** trabajo previo demora una respuesta admitida a tiempo
- **THEN** su espera y duración reflejan la demora, pero su timestamp de admisión no cambia y los datos de métricas no se usan para validarla ni puntuarla

#### Scenario: Worker atrasado y trabajo obsoleto
- **WHEN** se procesa un deadline atrasado después de admisiones pendientes y luego se repite el trabajo
- **THEN** se registra el retraso de la transición efectiva una sola vez y el no-op no inventa otra observación de cierre

#### Scenario: Fallo de instrumentación
- **WHEN** falla la exportación de métricas mientras existe trabajo de admisión pendiente
- **THEN** no se pierde la admisión, no se cambia su fecha y el resultado transaccional conserva el comportamiento que tendría sin exportador
