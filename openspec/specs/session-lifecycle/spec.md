# session-lifecycle Specification

## Purpose

Definir el comportamiento verificable del motor de partidas: permisos, estados, tiempos, revisión y finalización coherente, independientemente del transporte utilizado.

## Requirements

### Requirement: Estados y comandos de dominio independientes del transporte

El sistema SHALL gestionar salas con estados `WAITING`, `IN_PROGRESS` y `FINISHED`, y preguntas con estados `PENDING`, `OPEN` y `CLOSED`. Las decisiones SHALL pertenecer al dominio y ser reutilizables desde REST y futuros adaptadores WebSocket. `FINISHED` y `CLOSED` SHALL ser terminales para la sala y la pregunta respectivamente; no se permiten reinicios ni reaperturas.

#### Scenario: Comando fuera de orden
- **WHEN** el host solicita avanzar una sala en `WAITING`
- **THEN** se devuelve `INVALID_SESSION_STATE` sin abrir preguntas ni modificar la sala

#### Scenario: Partida finalizada
- **WHEN** se solicita iniciar, avanzar o finalizar otra vez una sala `FINISHED`
- **THEN** se devuelve `SESSION_FINISHED` y se conserva su historial sin cambios

### Requirement: Host exclusivo y separado de los jugadores

El sistema SHALL permitir que únicamente el host autenticado inicie, avance o finalice su sala. El host SHALL quedar excluido de participantes, respuestas, conteo de respuestas esperadas y clasificación. La desconexión del host SHALL NOT pausar ni finalizar automáticamente la partida.

#### Scenario: Acción sin permiso
- **WHEN** un participante intenta iniciar, avanzar o finalizar la sala
- **THEN** recibe `HOST_REQUIRED` y no se modifica el estado

#### Scenario: Host desconectado
- **WHEN** vence un plazo y el host no está conectado
- **THEN** el servidor ejecuta el cierre o avance correspondiente sin esperar al host

### Requirement: Inicio único y atómico

El sistema SHALL aceptar el inicio solo en `WAITING`, con al menos una pregunta copiada y un participante. El inicio SHALL cambiar la sala a `IN_PROGRESS`, fijar `startedAt`, establecer `currentIndex = 0` y abrir exclusivamente la primera pregunta de forma atómica. La lista de participantes SHALL quedar fijada al iniciar.

#### Scenario: Inicio válido
- **WHEN** el host inicia una sala en espera con preguntas y participantes
- **THEN** se abre la primera pregunta y el estado refleja un único inicio completo

#### Scenario: Sin preguntas
- **WHEN** el host intenta iniciar una sala cuya copia no contiene preguntas
- **THEN** recibe `SESSION_HAS_NO_QUESTIONS` y la sala permanece en espera

#### Scenario: Sin participantes
- **WHEN** el host intenta iniciar una sala sin participantes
- **THEN** recibe `SESSION_HAS_NO_PARTICIPANTS` y la sala permanece en espera

#### Scenario: Inicio repetido o simultáneo
- **WHEN** llegan dos solicitudes de inicio para la misma sala, secuencial o simultáneamente
- **THEN** solo una inicia la partida y la otra recibe `SESSION_ALREADY_STARTED`, sin cambiar el tiempo inicial ni abrir otra pregunta

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
