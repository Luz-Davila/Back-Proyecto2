## MODIFIED Requirements

### Requirement: Incorporación y suscripción autorizadas por sala

El servicio SHALL aceptar `room:join` con exactamente `{ code: <codigo> }`, con la normalización y reglas de incorporación de `session-rooms`, y suscribir únicamente al socket solicitante a la sala resultante tras autorizarlo. SHALL devolver exactamente `{ ok: true, data: { participant: <participante>, room: <RoomEnvelope> } }` en éxito. Una identidad previamente registrada SHALL recuperar su mismo participante, joinedAt y acumulado en WAITING, IN_PROGRESS o FINISHED, sin insertar jugadores, reservas o respuestas ni repetir puntuación, secuencia o broadcasts. Un jugador nuevo SHALL poder incorporarse solo en WAITING. SHALL aceptar `room:subscribe` con exactamente `{ sessionId: <uuid> }` para el host o un participante registrado, también en partidas finalizadas, sin crear participantes. El nombre interno de la room no SHALL ser un mecanismo de autorización. No SHALL suscribir automáticamente a todas las salas de una cuenta. La lectura inicial y la activación de la suscripción SHALL impedir perder una transición concurrente o conservar acceso después de una salida ya confirmada. La identidad SHALL proceder del JWT vigente, incluso desde otro dispositivo o después de reiniciar el servidor; no SHALL requerirse el socket anterior. El host SHALL seguir usando consulta/suscripción, no room:join para convertirse en jugador.

#### Scenario: Join válido y repetido
- **WHEN** el mismo jugador realiza room:join desde dos dispositivos en espera o recupera su incorporación existente durante la partida o después de finalizar
- **THEN** ambos sockets reciben `{ ok: true, data: { participant: <participante>, room: <RoomEnvelope> } }`, comparten participante y fecha de incorporación, recuperan el puntaje confirmado y quedan suscritos sin duplicados

#### Scenario: Host se conecta a su sala
- **WHEN** el host envía `room:subscribe` con el identificador de su sala
- **THEN** recibe `{ ok: true, data: <RoomEnvelope> }` y queda suscrito sin figurar como jugador

#### Scenario: Suscripción ajena o inexistente
- **WHEN** un usuario ajeno solicita suscribirse a una sala o proporciona un UUID sin sala asociada
- **THEN** recibe ack `SESSION_NOT_FOUND` sin estado y no recibe ningún broadcast de esa sala

#### Scenario: Restricciones de incorporación existentes
- **WHEN** se intenta un primer join después del inicio, un primer join a sala finalizada, participar como host propio o incorporarse a otra sala activa
- **THEN** se mantienen respectivamente `SESSION_NOT_JOINABLE`, `SESSION_FINISHED`, `HOST_CANNOT_PARTICIPATE` o `ALREADY_IN_ACTIVE_SESSION`, sin suscripciones no autorizadas

#### Scenario: Suscripción concurrente con un cambio
- **WHEN** un usuario autorizado se suscribe mientras cambia la pregunta o la lista de participantes
- **THEN** obtiene el cambio en su estado inicial o en una notificación posterior, sin regresar después a un estado anterior

#### Scenario: Reconexión después de un cierre con puntaje
- **WHEN** un jugador con puntaje confirmado pierde la conexión, obtiene una conexión nueva con JWT de la misma cuenta y envía room:join
- **THEN** recupera su mismo participantId, joinedAt y acumulado actual sin registros ni sumas adicionales ni reemisión de eventos históricos

#### Scenario: Recuperación no convierte al ajeno en participante
- **WHEN** una cuenta distinta intenta recuperar por room:join una sala IN_PROGRESS o FINISHED de otro jugador
- **THEN** se rechaza como nueva incorporación fuera de WAITING y no se devuelve un comprobante ni participación de otra identidad
