## Context

Ver `proposal.md` para motivación y los cuatro deltas para contratos. La implementación es NestJS/TypeORM sobre PostgreSQL, Socket.IO y una única instancia de aplicación; conserva sus bloqueos transaccionales y restricciones únicas. No se necesita infraestructura adicional.

La exploración encontró tres fuentes de amplificación:

1. `SessionsRepository.locked()` toma snapshots completos antes y después; `SessionAnswersService` toma otro dentro de la misma transacción. Una respuesta normal provoca aproximadamente 17 sentencias, aunque solo cambie una fila privada.
2. `persist()` recorre todas las respuestas de todas las preguntas calificadas y vuelve a actualizar sus puntajes. El benchmark de 900 respuestas produjo 27.900 UPDATE de puntajes y 43.880 consultas totales de las operaciones perfiladas.
3. `clock.now()` se consulta después de esperar el turno y de varias lecturas. La spec vigente lo exige expresamente. Cambiar `answeredAt` a admisión es una decisión de producto/contrato, no una refactorización transparente.

También existe deriva documental: el código desplegado ya acepta cuatro opciones, varias opciones válidas y rachas, mientras algunos requisitos antiguos solo describen booleanos y base 0/1/3. Este cambio conserva esas funcionalidades y alinea solo los requisitos afectados; no añade tipos ni cambia la fórmula de rachas.

Los diagnósticos ya ejecutados no son verificación de esta propuesta aún no implementada:

| Referencia previa | Guardadas | ACK máximo | Observación |
|---|---|---|---|
| Local 30 usuarios × 3 preguntas | 90/90 | 1.620 ms | Sin retardo artificial |
| Local 30 usuarios × 30 preguntas | 900/900 | 5.429 ms | 2.700 snapshots durante respuestas; 1.214.550 filas de respuestas recargadas |
| 30 usuarios, primeras 2 de 30 preguntas, +20 ms/consulta | 60/60 | 17.343 ms | 30 acks excedieron 8 s; integridad correcta, presupuesto del frontend incumplido |
| Mismo control, +50 ms/consulta | 56/60 | 30.465 ms | Cuatro admisiones previas al plazo rechazadas después de esperar |

Los archivos originales del diagnóstico están fuera del repo, en la carpeta temporal de OpenCode. En apply se incorporarán un resumen sanitizado y el ejecutor portable; no se inventará una revisión Git retroactiva para una medición que no la registró en su JSON.

## Goals / Non-Goals

**Goals:**

- Una ruta normal de respuesta cuyo volumen de datos y consultas no crezca con las respuestas históricas de la partida.
- Persistencia diferencial de cambios de estado y puntuación nueva; mantener atomicidad, unicidad, precedencia de errores, comprobantes, privacidad y resultados.
- Una fecha de admisión del servidor anterior al trabajo de BD/cola, coherente con el orden del cierre automático.
- Un benchmark repetible que compare el código previo y nuevo con los mismos parámetros y detecte regresiones estructurales además de latencia.

**Non-Goals:**

- Réplicas de aplicación, Redis, colas durables, migraciones remotas, nuevas rutas HTTP o cambios en Vercel/Railway.
- Aumentar el timeout del frontend para hacer pasar un caso, usar timestamps del alumno o recalificar partidas históricas.
- Añadir un acumulador de puntuación que sustituya el cálculo determinista o cambiar opciones válidas, rachas, imágenes o el chatbot.
- Garantizar la recepción física en la red antes de autenticar. La frontera definida es la entrada del comando autenticado y validado al servicio de respuestas, no `Date.now()` del navegador ni el timestamp de una trama sin validar.

## Decisions

### 1. Medir primero y mantener una referencia comparable

Promover los diagnósticos temporales a utilidades de prueba TypeScript del proyecto, reutilizando `test/support/local-game-harness.ts`. La instrumentación de consultas y retardo residirá solo en tests, separada de la aplicación desplegable. El proceso de carga, el servidor y PostgreSQL serán reales; las claves de autenticación serán locales y Storage/telemetría seguirán los stubs explícitos del harness.

El informe registrará fases, consultas y filas modificadas/recargadas, latencia cliente y espera interna por separado, revisión/dirty al ejecutar, parámetros y limpieza. No se correrán suites de CPU/BD en paralelo al benchmark.

Alternativa descartada: usar solo el benchmark desplegado como prueba de una causa única. No se midieron allí por separado CPU, red y consultas; el retardo local es una reproducción controlada del mecanismo, no esa medición faltante.

### 2. Ruta dedicada de aceptación con contexto mínimo

No hacer pasar respuestas normales o replay por `locked()` si eso obliga a snapshots públicos completos. Mantener la exclusión por sala y la transacción, pero obtener un contexto selectivo que incluya solo:

- sala y su estado/host/índice actual;
- pregunta solicitada, tipo, fase y límites temporales;
- participante de la identidad autenticada;
- respuesta existente para ese par, si la hay.

La pertenencia se comprueba antes de devolver un comprobante o un error que revele estado. El host conserva su error específico. Un replay devuelve la fila original y termina sin lecturas del historial, conteos de participación ni cálculos de puntuación. Un conflicto conserva `ANSWER_ALREADY_SUBMITTED`.

Para una respuesta nueva, validar el tipo persistido y la fecha confiable de admisión, insertar y determinar si completa la participación válida. Los conteos excluyen host, respuestas ajenas y registros fuera de la ventana. La restricción única continúa siendo la defensa de BD; cualquier recuperación de una colisión se hace en una transacción nueva y revalida pertenencia, sin repetir timestamps ni observaciones de accepted.

Si no cierra, devolver únicamente el recibo privado después de commit. Si completa la pregunta, cargar una vez el agregado necesario para las reglas de cierre, bono/racha y notificación; clonar su estado público previo a la mutación, aplicar reglas y persistir solo el delta. La lectura contiene la respuesta recién insertada dentro de la misma transacción. Ningún ack o evento de éxito precede al commit.

Alternativas descartadas: quitar bloqueos/uniqueness para paralelizar escrituras, o mantener tres snapshots y subir el timeout. La primera compromete invariantes; la segunda conserva el cuello de botella.

### 3. Pocas idas a BD, no solo menos entidades hidratadas

Objetivo de la ruta caliente, después de resolver una vez el enrutamiento inmutable pregunta→sala para el grupo pendiente:

1. BEGIN.
2. Lectura selectiva autorizable con bloqueo de la fila de sala.
3. Inserción y conteos mediante una operación PostgreSQL parametrizada que devuelva el recibo y la condición de participación completa.
4. COMMIT, cuando no se requiere cerrar.

La resolución de sala puede compartirse entre admisiones pendientes de la misma pregunta; se obtiene de BD/estado confirmado del servidor, nunca de un `sessionId` del cliente. Su caché/Promise es acotada al trabajo activo y no sustituye la autorización transaccional. Si no puede usarse la sentencia combinada de forma segura, se admite temporalmente separar operaciones para implementar corrección, pero no declarar cumplido el objetivo de rendimiento hasta medir y reducir las idas restantes.

**Detalle obligatorio de PostgreSQL:** una CTE de escritura y su SELECT comparten snapshot. El conteo de filas de la tabla no ve por sí solo el INSERT de la misma sentencia; se debe combinar el conteo previo con la fila efectivamente devuelta por `INSERT ... RETURNING`, sin contar dos veces un conflicto. Probar 29→30 respuestas y replay para detectar ese error. El bloqueo de sala se obtiene en una sentencia anterior al conteo/inserción para disponer de una vista consistente posterior a cualquier espera del bloqueo. No fusionar todo en una consulta que lea conteos obsoletos antes de adquirirlo.

Presupuestos estructurales del benchmark:

- Ruta normal no final: cero snapshots completos; objetivo cuatro sentencias dentro de la exclusión de sala, como máximo ocho por invocación incluyendo enrutamiento cuando sea necesario.
- Partida 30×30 completa: menos de 10.000 sentencias de operaciones perfiladas, frente a 43.880 de referencia, contando control de transacción igual en ambos lados.
- Puntajes: una operación de lote por pregunta recién calificada, máximo 30 lotes y 900 filas de respuesta calificadas en la partida de prueba; cero reescrituras de puntajes al avanzar o finalizar sin un cierre nuevo.

Estos son criterios por demostrar, no resultados obtenidos. La suite por defecto puede comprobar la forma de consultas y deltas sin depender de tiempos reales; el benchmark opt-in decide aparte si se satisface el presupuesto de 8 s de ack en el entorno declarado.

### 4. Persistir solo las transiciones y calificaciones nuevas

Reutilizar un único agregado mutable cuando una operación de ciclo de vida sí lo necesita, conservando una copia previa para calcular el delta y los eventos. Evitar la lectura interior duplicada de la misma transacción; no reutilizar estados obtenidos fuera de su exclusión.

Calcular `newlyScoredQuestionIds` comparando los marcadores `scoredAt` antes/después. Actualizar por lote exclusivamente los puntajes pertenecientes a esas preguntas, incluso si su valor nuevo es cero. No usar `score > 0` ni diferencias numéricas para decidir qué pregunta fue calificada: deben conservarse cierres con todos incorrectos y eventos `scoreboard:updated`.

Una actualización parametrizada `UPDATE ... FROM (VALUES ...)` acotada a la pregunta permite escribir los distintos puntajes sin un round trip por jugador. Filas y parámetros proceden del cálculo del dominio y se validan contra el alcance de la transacción; no se concatena contenido de usuario. La escritura de resultados finales sigue siendo única y atómica, sin tocar los recibos/fechas de respuestas previas. No se ejecutan cambios de estado para no-ops ni se aumenta el stream.

Alternativa descartada: volver a guardar todo el agregado con cambios individuales de cada Answer, aun cuando el ORM detecte valores iguales; la latencia por sentencia sigue existiendo.

### 5. Admisión antes de BD y orden por pregunta antes del cierre automático

Cambiar solo el argumento de tiempo de `requireAnswerWindow()` es insuficiente: el worker podría cerrar mientras una respuesta anterior todavía resuelve su sala. Introducir un coordinador interno de admisiones por pregunta que registre sin await el ticket, su secuencia y el timestamp del reloj del juego al entrar al servicio autenticado/validado, antes de `sessionForQuestion()` o de esperar otro ticket.

```text
autenticación + DTO válidos
          │
          ▼
ticket por pregunta + admittedAt del servidor
          │
          ▼
turno de pregunta → resolución de sala compartida → exclusión de sala → BD
          │                                           │
          │                                           ├─ replay: recibo original
          │                                           ├─ nueva: persistir admittedAt
          │                                           └─ última: cierre/puntajes atómicos
          ▼
cierre automático de esa pregunta detrás de admisiones previas
```

El cierre ANSWER y el avance REVIEW se coordinan con la misma pregunta esperada antes de tomar la exclusión de sala. Los tickets admitidos desde `closesAt` se rechazan por su propia fecha, aunque el worker esté atrasado; no generan una gracia nueva. Una admisión nunca autoriza por sí misma: permisos, fase y replay se verifican en la transacción.

Orden global de adquisición: pregunta/admisión → sala → transacción. Nunca esperar la cola de pregunta mientras se conserva el bloqueo de sala, ni reencolar recursivamente el cierre de la última respuesta. Este último sigue siendo una regla de dominio dentro de su transacción actual. Salas distintas no comparten cola global.

Cada ticket termina/libera en `finally`, incluso con rechazo o rollback; al vaciarse la cola se eliminan sus referencias y enrutamiento. El shutdown espera el trabajo en curso y no abandona promesas/listeners. La política sigue siendo la de una instancia: no promete una cola durable ni orden entre réplicas. Se conserva el límite actual de autenticación/ack: un token debe ser válido al procesar el comando autenticado y no se entregan acks/broadcasts a sockets vencidos; las reglas existentes de refresh y recuperación no se sustituyen por el ticket.

Alternativa descartada: capturar una fecha y permitir INSERT en preguntas CLOSED/FINISHED. Rompe terminalidad, puntuación y recuperación. La finalización manual conserva su autoridad: puede ganar la exclusión antes que una admisión no confirmada, que entonces se rechaza; la garantía de espera se aplica al cierre/avance automáticos, no a reabrir lo que el host ya terminó.

### 6. Conservar calendario y resultados confirmados

`answeredAt` nuevo será `admittedAt` del reloj del servidor y se usará también para el bono de rapidez. No se modifica la fórmula de acierto, varias opciones válidas, empate o racha. El instante de procesamiento sigue disponible solo para duración de trabajo y transición efectiva.

El cierre por deadline conserva `closedAt = closesAt`. El cierre por participación completa conserva la última fecha aceptada de esa pregunta. La revisión conserva su plazo efectivo, sin alargarlo por cola; si ya venció al completarse el trabajo, el worker puede avanzar conforme a las reglas de recuperación existentes. Una nueva pregunta obtiene su propio tiempo completo desde su apertura, no desde un deadline de la anterior. No se publican resultados parciales ni recalifican filas históricas.

### 7. Observabilidad y pruebas como partes del cambio

Mantener contadores e histogramas existentes, separando la fecha de dominio de `performance.now()`. La espera efectiva de admisión y sala se mide sin doble conteo: no registrar dos muestras parciales como si fueran dos comandos. No incorporar ids de sala/pregunta/usuario ni SQL como etiquetas. Conteos de SQL/filas pertenecen al perfilador de prueba, no a nuevas etiquetas de producción.

Pruebas necesarias:

- Reglas/servicios deterministas: frontera exacta, admisión previa procesada después, primera elección ganadora, rapidez con fechas empatadas, varias opciones válidas y rachas.
- Coordinación: bloquear expresamente una operación y hacer competir respuestas/deadline; dos salas, excepción, replay, host finish, no-ops y shutdown. Verificar el orden, no depender de sleeps largos.
- PostgreSQL real: últimas respuestas simultáneas, CTE/count antes/después del insert, conflicto único, rollback durante el lote y ninguna actualización de puntajes cerrados al avanzar/finalizar.
- Socket.IO: formatos/errores, permisos, privacidad antes del cierre, un ack por comando, eventos posteriores a commit, aislamiento y reconexión/reinicio con datos confirmados.
- Benchmark después de las suites, sin otras cargas: referencia 3 preguntas, ejecución completa 30×30, controles de dos preguntas con 20/50 ms y presupuesto 8.000 ms. Repetir casos para confirmar que una muestra aislada no se anuncia como capacidad productiva. No prometer que un equipo cualquiera cumplirá un SLO fijo.

## Risks / Trade-offs

- [Cambia una regla temporal y la referencia de rapidez] → Marcar BREAKING en propuesta/deltas, revisar antes de apply y no recalcular respuestas antiguas.
- [La cola de admisión omite autorización o bloquea tras fallar] → Registrar solo comandos autenticados/validados, autorizar en BD, limpiar en `finally`, probar rechazos y liberación; no introducir una reserva que conceda pertenencia.
- [Admisiones en memoria se pierden al reiniciar] → Solo un commit acredita respuesta; retry recupera la fila o se admite de nuevo sin retrofecha. No prometer durabilidad de tickets.
- [Aplicar la política con varias réplicas rompe su orden local] → Mantener explícitamente una instancia y considerar coordinación distribuida un cambio separado.
- [CTE devuelve conteo equivocado o una espera usa snapshot obsoleto] → Pruebas reales de PostgreSQL con 29→30, conflictos y bloqueo; usar RETURNING para el insert nuevo y obtener el bloqueo antes de la sentencia de conteo.
- [Deltas omiten un cierre con cero puntos o cambian rachas] → Seleccionar por transición de scoredAt, no por score, y contrastar puntuación/stream con los tests existentes.
- [Pocas consultas todavía no cumplen 8 s en algún entorno] → Reportar fallo de presupuesto aunque la integridad pase; no aumentar el timeout ni tocar el despliegue automáticamente. El benchmark es evidencia local, no diagnóstico de recursos de Railway.
- [Las pruebas escriben en la BD equivocada o borran datos ajenos] → Guardas de loopback/BD distinta, esquemas propios con migraciones y limpieza exacta del harness; nunca usar DATABASE_URL como fallback.

## Migration Plan

1. Revisar y validar propuesta, deltas, diseño y tareas; salir de propose y esperar un pedido posterior de apply.
2. Incorporar referencia sanitizada y pruebas de regresión, optimizar persistencia diferencial, implementar ruta corta y finalmente admisión/cierre coordinados, verificando cada etapa.
3. Ejecutar suites y benchmark local, guardar comparación antes/después y marcar tareas solo con evidencia real. No sincronizar specs ni archivar el cambio mientras falten verificaciones.
4. Una vez revisado el cambio completo, sincronizar/archivar según el flujo OpenSpec autorizado. Push, despliegue y pruebas remotas requieren instrucciones separadas.
5. No se prevé migración de tablas. Ante evidencia de que hace falta un índice o cambio de esquema, actualizar el diseño/propuesta y detener esa ampliación antes de ejecutarla.
6. Rollback de una entrega futura: volver a la revisión de código anterior conservando respuestas y resultados ya guardados. No intentar restaurar semántica histórica recalculando timestamps/bonos. Esta propuesta por sí misma no despliega ni aplica ese rollback.
