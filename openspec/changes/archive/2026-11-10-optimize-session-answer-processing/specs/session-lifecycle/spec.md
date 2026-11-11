## MODIFIED Requirements

### Requirement: Duración de respuesta y cierre anticipado por participación completa

El sistema SHALL conservar los tiempos implementados: duración propia de la pregunta entre 5 y 120 segundos cuando exista, o la duración de sala del mismo rango y default 30. Cada apertura SHALL registrar `openedAt` y `closesAt`. Una pregunta SHALL cerrarse al alcanzar su plazo o cuando todos los participantes fijados al inicio tengan una respuesta aceptada, lo que suceda primero, procesando antes las admisiones anteriores al cierre automático según `game-answers`. Una admisión nueva a partir de `closesAt` SHALL ser tardía aunque el proceso de cierre esté pendiente. Respuestas duplicadas, rechazadas o de otra sala SHALL NOT contar para el cierre. La última aceptación, cierre y puntuación SHALL confirmarse atómicamente con la fórmula y rachas existentes; cerrar por plazo SHALL conservar el deadline efectivo. La espera de trabajo ya admitido SHALL NOT ampliar la ventana para nuevos envíos, recalificar históricos ni permitir reabrir una pregunta cerrada.

#### Scenario: Vencimiento de tiempo
- **WHEN** se alcanza `closesAt` y quedan jugadores sin responder
- **THEN** se resuelven las admisiones anteriores pendientes y se cierra/puntúa usando el deadline persistido; las omisiones restantes aportan cero sin respuestas ficticias

#### Scenario: Todos respondieron antes del plazo
- **WHEN** se procesa la última respuesta pendiente admitida antes de `closesAt`
- **THEN** se cierra y puntúa en esa misma transacción sin esperar el deadline ni insertar respuestas adicionales

#### Scenario: Respuesta de otra sala
- **WHEN** se acepta una respuesta correspondiente a una pregunta de otra sala
- **THEN** no cambia el conteo, puntuación ni estado de la pregunta actual de esta sala

#### Scenario: Frontera de tiempo
- **WHEN** una respuesta nueva tiene instante autoritativo de admisión igual o posterior a `closesAt`
- **THEN** no se acepta ni se inserta un registro, aunque otros trabajos previos sigan en cola

#### Scenario: Trabajo fallido antes del cierre
- **WHEN** una admisión pendiente termina por rechazo de autorización, validación o rollback
- **THEN** libera su turno y el cierre puede continuar sin contar una respuesta inexistente ni quedar bloqueado por el fallo

### Requirement: Plazos recuperables y aislamiento de ejecución

El sistema SHALL usar el reloj del servidor y estado persistido como autoridad. En la instancia que atiende la sala, un cierre automático SHALL respetar el orden de admisiones de esa pregunta ya registradas antes del vencimiento; el retraso no SHALL cambiar `closesAt` ni admitir envíos nuevos tardíos. Tras un reinicio SHALL recuperar salas activas y transiciones vencidas sin reabrir preguntas ni saltar preguntas nunca mostradas. Una admisión sin commit antes de una caída SHALL NOT considerarse respuesta persistida ni tener garantía durable de recuperación; un reintento SHALL recuperar una fila confirmada o evaluarse como una admisión nueva. Cada transición SHALL afectar exclusivamente su sala y pregunta esperada, sin permitir que trabajo ajeno o un fallo de otra sala retenga el cierre.

#### Scenario: Recuperación tras reinicio
- **WHEN** el servidor reinicia con una pregunta cuyo plazo venció
- **THEN** la cierra usando el vencimiento persistido como cierre efectivo, respeta la revisión restante y abre como máximo la siguiente pregunta al recuperarse

#### Scenario: Dos salas simultáneas
- **WHEN** vencen plazos de dos salas con diferentes preguntas y participantes
- **THEN** cada sala avanza de manera independiente sin mezclar ni bloquear globalmente respuestas, índices, participantes o resultados

#### Scenario: Caída antes de confirmar una admisión
- **WHEN** se pierde una admisión en memoria sin commit y el cliente reintenta tras reiniciar
- **THEN** no se inventa un comprobante ni se retrofecha el reintento; solo se recupera una respuesta realmente confirmada o se aplican las reglas de una nueva admisión

## ADDED Requirements

### Requirement: Puntajes cerrados estables durante transiciones posteriores

El sistema SHALL conservar los puntajes confirmados de preguntas ya calificadas al abrir otras preguntas, avanzar revisiones, recuperar estado y finalizar. Una transición que califica una pregunta nueva SHALL modificar únicamente sus puntajes y los cambios de ciclo de vida/resultados que le correspondan, sin reescribir los puntajes de preguntas previamente calificadas. Una finalización que no cierra ninguna pregunta nueva SHALL construir resultados sin volver a escribir las respuestas históricas. El conjunto de cambios nuevos SHALL ser atómico y mantener la clasificación, bonos y rachas existentes.

#### Scenario: Avance después de un cierre
- **WHEN** se termina la revisión y se abre la siguiente pregunta
- **THEN** los registros de puntaje ya confirmados no se vuelven a escribir ni cambian sus valores

#### Scenario: Finalización sin pregunta nueva que puntuar
- **WHEN** el host finaliza durante revisión o finaliza automáticamente tras la última revisión
- **THEN** se guardan los resultados definitivos sin modificar nuevamente los puntajes de respuestas cerradas

#### Scenario: Rollback al puntuar una pregunta nueva
- **WHEN** falla parte de la escritura de puntajes recién calculados
- **THEN** no queda una pregunta parcialmente calificada ni una nueva respuesta confirmada que pertenecía a esa misma transacción
