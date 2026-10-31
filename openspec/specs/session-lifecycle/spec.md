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

### Requirement: Plazos recuperables y aislamiento de ejecución

El sistema SHALL usar el reloj del servidor y estado persistido como autoridad. Tras un reinicio SHALL recuperar las salas activas y procesar transiciones vencidas sin reabrir preguntas ni saltar preguntas nunca mostradas. La demora de ejecución SHALL NOT ampliar la ventana de aceptación de respuestas. Cada transición SHALL afectar exclusivamente su sala y la pregunta esperada.

#### Scenario: Recuperación tras reinicio
- **WHEN** el servidor reinicia con una pregunta cuyo plazo venció
- **THEN** la cierra usando el vencimiento persistido como cierre efectivo, respeta la revisión restante y abre como máximo la siguiente pregunta al momento de recuperación

#### Scenario: Dos salas simultáneas
- **WHEN** vencen plazos de dos salas con diferentes preguntas y participantes
- **THEN** cada sala avanza de manera independiente sin mezclar respuestas, índices, participantes ni resultados
