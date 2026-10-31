## RENAMED Requirements

- FROM: `### Requirement: Revisión de cinco segundos y avance automático`
- TO: `### Requirement: Revisión configurable y avance automático`

## MODIFIED Requirements

### Requirement: Duración de respuesta y cierre anticipado por participación completa

El sistema SHALL usar para todas las preguntas la duración entera de 5 a 120 segundos fijada al crear la sala, con default 30. Cada apertura SHALL registrar `openedAt` y `closesAt`. Una pregunta SHALL cerrarse al alcanzar su plazo o cuando todos los participantes fijados al inicio tengan una respuesta aceptada para esa pregunta, lo que suceda primero. Una respuesta nueva a partir de `closesAt` SHALL ser considerada tardía aunque aún no se haya ejecutado el proceso de cierre. Respuestas duplicadas, rechazadas o de otra sala SHALL NOT contar para el cierre. La última aceptación, cierre y puntuación 0/1/3 de `game-answers` SHALL confirmarse atómicamente; cerrar por plazo SHALL puntuar con la misma fórmula y conservar el deadline efectivo.

#### Scenario: Vencimiento de tiempo
- **WHEN** se alcanza `closesAt` y quedan jugadores sin responder
- **THEN** la pregunta se cierra y puntúa, esas omisiones aportan cero puntos y no se crean respuestas ficticias

#### Scenario: Todos respondieron antes del plazo
- **WHEN** se acepta la última respuesta pendiente de los participantes de la sala antes de `closesAt`
- **THEN** se cierra y puntúa inmediatamente en la misma transacción sin esperar el tiempo restante

#### Scenario: Respuesta de otra sala
- **WHEN** se acepta una respuesta correspondiente a una pregunta de otra sala
- **THEN** no cambia el conteo, puntuación ni estado de la pregunta actual de esta sala

#### Scenario: Frontera de tiempo
- **WHEN** se evalúa una respuesta nueva con tiempo de servidor igual o posterior a `closesAt`
- **THEN** no se acepta para esa pregunta ni se inserta un registro

### Requirement: Revisión configurable y avance automático

Al cerrar una pregunta, el sistema SHALL persistir el instante efectivo de cierre y un plazo de revisión separado por los 3 a 15 segundos configurados para la sala, con default 5. Durante revisión SHALL revelar la solución de esa pregunta y clasificación acumulada confirmada, rechazar respuestas nuevas y mantener la sala IN_PROGRESS; recuperar un comprobante previo no SHALL considerarse una respuesta nueva. Cumplido el plazo SHALL abrir automáticamente la siguiente pregunta o finalizar si no quedan preguntas. El avance manual del host SHALL NOT interrumpir una pregunta abierta ni acortar la revisión. Un cierre/puntuación ya confirmado no SHALL repetirse por la carrera de avance o por un temporizador viejo.

#### Scenario: Revisión visible
- **WHEN** cierra una pregunta y aún no termina su revisión configurada
- **THEN** el estado muestra pregunta cerrada, solución, clasificación confirmada y plazo efectivo, sin abrir la siguiente

#### Scenario: Avance manual prematuro
- **WHEN** el host solicita avanzar mientras la pregunta está abierta o durante la revisión
- **THEN** recibe `QUESTION_NOT_CLOSED` o `REVIEW_IN_PROGRESS` respectivamente y no se acortan los plazos

#### Scenario: Siguiente pregunta
- **WHEN** termina la revisión y queda otra pregunta pendiente
- **THEN** se abre exactamente la siguiente y su tiempo completo de respuesta comienza en esa nueva apertura

#### Scenario: Última pregunta
- **WHEN** termina la revisión de la última pregunta
- **THEN** la sala pasa a FINISHED y se conservan resultados finales iguales a los acumulados confirmados

#### Scenario: Carrera entre avance manual y automático
- **WHEN** el host y el servidor intentan avanzar la misma pregunta simultáneamente después de la revisión
- **THEN** ocurre un solo avance y ninguna solicitud ni temporizador obsoleto salta otra pregunta o duplica puntos

### Requirement: Finalización anticipada y resultados persistentes

El sistema SHALL permitir al host finalizar una sala WAITING o IN_PROGRESS. La finalización explícita SHALL cancelar aperturas futuras, cerrar y puntuar la pregunta abierta si existe y fijar `finishedAt`, sin exigir revisión adicional. Las preguntas nunca abiertas SHALL permanecer PENDING y no contribuir a resultados. SHALL conservar participantes, copias, respuestas aceptadas y un resultado por participante, sumando los puntajes confirmados de preguntas cerradas, incluida la que acaba de cerrar, y asignando cero a omisiones. No SHALL aumentar un acumulador por repetir eventos ni recalcular preguntas previamente puntuadas; los resultados históricos heredados SHALL preservarse. Los empates SHALL compartir puesto con clasificación densa descendente. Finalizar en espera SHALL producir resultados de cero sin abrir/puntuar preguntas. El host SHALL permanecer excluido.

#### Scenario: Finalización durante una pregunta
- **WHEN** el host finaliza con una pregunta abierta y respuestas aceptadas
- **THEN** se puntúa y cierra esa pregunta junto con los resultados finales, se conservan respuestas y las omisiones aportan cero sin abrir preguntas pendientes

#### Scenario: Finalización durante la espera
- **WHEN** el host finaliza una sala WAITING
- **THEN** no se abre ninguna pregunta, startedAt permanece vacío y se guardan resultados de cero para los participantes existentes

#### Scenario: Empate
- **WHEN** los puntajes finales son 3, 3 y 1
- **THEN** los puestos son 1, 1 y 2, y no se agrega un resultado del host

#### Scenario: Finalización y temporizador concurrentes
- **WHEN** coincide la finalización con un temporizador de cierre o avance
- **THEN** la sala queda finalizada una sola vez, con un resultado por participante, sin aperturas posteriores ni sumas duplicadas
