# Respuestas: contrato temporal y rendimiento

## Por qué cambia el contrato

El contrato anterior fijaba `answeredAt` al validar dentro del bloqueo de sala. Así, un alumno que respondió a tiempo podía perder la respuesta y el bono de rapidez por consultas o trabajos que otros envíos colocaron delante del suyo. No era posible corregirlo únicamente aumentando el timeout del frontend.

El nuevo contrato fija la fecha con **el reloj del servidor al entrar el comando autenticado y validado al servicio**, antes de consultar BD o esperar coordinación. Esa fecha se conserva si se confirma el INSERT. El cierre automático de la pregunta respeta las admisiones anteriores. Se mantiene el límite exclusivo `answeredAt < closesAt`: no hay segundos extra para nuevos envíos ni confianza en un timestamp del navegador.

Esto es mejor porque separa el momento de responder del costo de procesar, mantiene una referencia de rapidez verificable y no hace depender la nota de la posición en la cola de BD. No elimina la latencia de red/autenticación anterior al servicio, no garantiza una recepción física en la red y no promete durabilidad de trabajo sin commit. Una finalización manual puede ganar el bloqueo y sigue siendo terminal. Los datos ya confirmados no se recalifican. Se requiere **una sola instancia** para el orden local de admisiones; varias réplicas requieren otro diseño.

El cambio es deliberadamente semántico, no una refactorización invisible: un envío antes penalizado por espera puede ahora aceptarse y su bono usa la admisión del servidor. No cambia payloads, comprobantes, permisos, errores, rachas ni la selección única entre varias opciones válidas.

## Referencia anterior a la optimización

Diagnóstico local realizado el 11-11-2026 UTC, PostgreSQL 17 en Docker, 30 clientes Socket.IO de Node, claves de prueba locales y esquemas propios. Sin interfaz, llamadas a Supabase/DeepSeek, Storage real ni Grafana. El JSON original no registró revisión Git: no se le atribuye una después del hecho. Los tiempos incluyen instrumentación y son muestras de ese entorno, no capacidad productiva.

| Caso | Guardadas | ACK p50 | ACK máximo | ACK > 8 s | Integridad | Presupuesto 8 s |
|---|---:|---:|---:|---:|---|---|
| 30 alumnos × 3 preguntas | 90/90 | 702 ms | 1.620 ms | 0 | correcta | cumple |
| 30 alumnos × 30 preguntas | 900/900 | 973 ms | 5.429 ms | 0 | correcta | cumple |
| +20 ms artificiales por consulta, 2 de 30 preguntas | 60/60 | 8.126 ms | 17.343 ms | 30 | correcta | no cumple |
| +50 ms artificiales por consulta, 2 de 30 preguntas | 56/60 | 16.084 ms | 30.465 ms | 46 | correcta para lo aceptado | no cumple |

La partida de 900 respuestas generó **43.880 sentencias perfiladas**, incluidos BEGIN/COMMIT y ciclo de vida, **2.700 snapshots** durante envíos y **27.900 UPDATE de puntajes**. Los cuatro rechazos del control de 50 ms habían llegado al servicio antes del plazo; la espera en cola llegó a unos 29 s. Los controles de latencia fueron solo 60 envíos cada uno, no 900, y no representan latencia medida en Railway.

## Reproducir la verificación

Desde la raíz del backend, con dependencias instaladas y PostgreSQL de pruebas disponible, configurar `TEST_DATABASE_URL` en el entorno o `.env`. Debe ser una BD exclusiva en loopback, distinta de `DATABASE_URL` incluso si se usa otro alias local. No se permite usar `DATABASE_URL` como fallback; no es necesario modificarla ni conectarse a ella.

```sh
npm run build
npx tsc --noEmit
npm test -- --runInBand
npm run test:integration
npm run test:sessions
npm run test:sockets
# Una vez terminadas las suites, sin otras cargas de CPU/BD:
npm run test:answers:benchmark -- --case=all --repetitions=2
```

El último comando genera `.tmp/session-answer-benchmark.json` y `.md` (ignorados por Git). `--output=docs/benchmarks/session-answer-optimized.json` permite conservar evidencia sanitizada. Casos individuales: `--case=30x3`, `30x30`, `20ms` o `50ms`; de una a tres repeticiones, dos por defecto. No hacen falta navegador, JWT de Supabase, chatbot, Storage real ni exportadores. Los esquemas aleatorios y el proceso hijo pertenecen al harness y son lo único que se limpia.

Todos los casos usan **30 clientes Socket.IO, ventana de 30 s y timeout real de ACK de 8.000 ms**. Los controles `20ms` y `50ms` juegan exactamente **dos preguntas de un cuestionario de 30: 60 envíos**, y luego el host finaliza. El límite total por caso es seis minutos; no sustituye el límite por ACK. Una pérdida de ACK o un ACK mayor a 8 s impide aprobar aunque las filas se hayan guardado.

Se comprueban elecciones y fechas contra PostgreSQL, unicidad de recibos y pares pregunta/participante, 30 resultados, puntajes calculados independientemente (bono rápido de 3 s, empates y rachas), ranking denso, conteos del historial y estabilidad de puntajes cerrados. Los tiempos cliente incluyen autenticación, red local y ACK; el perfil interno usa reloj monotónico y mide por separado cola/SQL. El retardo artificial afecta cada sentencia perfilada, incluidos BEGIN y COMMIT; no simula exactamente una red real.

El presupuesto de consultas cuenta las operaciones de respuesta y ciclo de vida perfiladas, igual que la referencia: **no es todo el SQL de la vida del proceso**. Quedan fuera migraciones/seed/joins, consultas del verificador, snapshots HTTP y el sondeo periódico `dueDeadlines`. Las transiciones que produce ese sondeo sí se cuentan. El JSON desglosa las fases, versiones, revisión y dirty, huella de los archivos listados, concurrencia máxima observada, snapshots/filas recargadas y lotes/filas de puntajes. No contiene JWT, credenciales, SQL con valores ni identidades.

## Pruebas de corrección

- Build y comprobación TypeScript completa, incluido `test/`: correctos.
- Unitarias: **243/243**, 34 suites, incluidas regresiones del propio verificador de carga.
- Integración: **10/10**, 2 suites.
- Sesiones PostgreSQL: **92/92**, 9 suites.
- Socket.IO: **87/87**, 6 suites. Los logs de fallos inyectados son esperados; las aserciones comprueban rollback y recuperación, no los ocultan.
- Regresiones inicialmente rojas: admisión previa con procesamiento posterior al plazo, snapshots intermedios y reescritura de puntajes. Pasan tras el cambio.
- Frontera exacta, ruta demorada, deadlines concurrentes/obsoletos, dos salas, finalización manual ganadora, host/filas ajenas fuera del conteo, 29→30, todos incorrectos, error durante el lote y colisión PostgreSQL real con recuperación en otra transacción.
- Shutdown y limpieza FIFO; caída real del hijo con INSERT sin commit y reintento tras reiniciar sin retrofechar. Los tickets no son una cola durable.

La ruta normal usa **cuatro sentencias críticas** (BEGIN, lectura selectiva/bloqueo, INSERT+conteo y COMMIT), más una de enrutamiento cuando no hay resolución compartida. El replay usa tres críticas más enrutamiento. Las pruebas exigen cinco/cuatro en total respectivamente y cero snapshots completos; los cierres sí cargan una vez el agregado y puntúan por lote. El worker despacha plazos de salas distintas de forma independiente, manteniendo el orden local dentro de cada sala/pregunta.

## Resultados de carga posteriores

### Primera ejecución, conservada incluso con fallos

[`benchmarks/session-answer-initial.md`](benchmarks/session-answer-initial.md) y su JSON conservan las ocho primeras mediciones posteriores al cambio. **No todas aprobaron**:

- 30×3: ambas pasaron; ACK máximo 1.145 y 3.079 ms.
- 30×30: la primera tuvo **60 timeouts**; la segunda pasó con 900 respuestas y ACK máximo **1.135 ms**. Ambas guardaron **900/900** filas, 30 resultados y puntuación/ranking coherentes; ejecutaron 4.256/4.305 sentencias y **30 lotes/900 filas** de puntajes.
- +20 ms: ambas pasaron con 60/60, máximo 4.301/4.339 ms.
- +50 ms: ambas guardaron 60/60, pero cada una tuvo **dos timeouts**. No cumplen el presupuesto de 8 s.

En la primera partida larga se observaron operaciones internas de hasta **46.531 ms** y tiempo SQL agregado por operación de hasta 21.998 ms, sin retardo artificial. No se aisló la causa de esa pausa: no se atribuye a Railway ni se presenta la segunda muestra rápida como sustituta del fallo. `ackMs` incluye la espera hasta el timeout cuando este ocurre: **no mide cuánto habría tardado un ACK posterior**. El perfil del servidor sí conserva la duración interna completa.

El verificador inicial marcó `integrity=false` en los casos con timeouts porque exigía disponer de todos los recibos para validar fechas/elecciones; además, registraba puntajes de preguntas todavía abiertas como si ya fueran históricos. Esos indicadores iniciales **no permiten diagnosticar corrupción de BD**. Se conservaron sin reescribir y se corrigió el verificador, con pruebas unitarias: la integridad persistida y la validez/cobertura de recibos se evalúan separadamente; la estabilidad solo observa preguntas ya calificadas. Un timeout sigue haciendo fallar el caso, aunque toda la BD resulte correcta.

### Repetición con verificador corregido

[`benchmarks/session-answer-optimized.md`](benchmarks/session-answer-optimized.md) y su JSON son la evidencia final: ocho mediciones, dos por configuración, ejecutadas después de corregir **solo el verificador**. El código de producción no cambió entre tandas. El informe registra revisión `4ce9c9e8`, árbol **dirty**, Node 22.23.4, Windows, PostgreSQL 17.11, 8 CPU lógicas y 8 GiB; no contiene JWT, credenciales, identidades ni SQL con valores.

| Caso | Rep. | Estado | Filas | ACK p95 / máx ms | >8 s | Consultas | Lotes / filas de puntaje | Recibos |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 30×3 | 1 | PASS | 90 | 534 / 727 | 0 | 444 | 3 / 90 | 90/90 |
| 30×3 | 2 | PASS | 90 | 421 / 500 | 0 | 444 | 3 / 90 | 90/90 |
| 30×30 | 1 | **PASS** | 900 | 637 / 1.403 | 0 | 4.305 | 30 / 900 | 900/900 |
| 30×30 | 2 | **PASS** | 900 | 874 / 2.925 | 0 | 4.305 | 30 / 900 | 900/900 |
| +20 ms | 1 | PASS | 60 | 3.817 / 4.525 | 0 | 294 | 2 / 60 | 60/60 |
| +20 ms | 2 | PASS | 60 | 3.611 / 4.069 | 0 | 294 | 2 / 60 | 60/60 |
| +50 ms | 1 | **FAIL (latencia)** | 60 | 7.540 / 8.006 | 2 | 294 | 2 / 60 | 58/60 |
| +50 ms | 2 | **FAIL (latencia)** | 60 | 7.506 / 8.015 | 2 | 294 | 2 / 60 | 58/60 |

En las dos repeticiones exitosas de 30×30 se confirmaron **900 respuestas únicas, 30 resultados, elecciones y fechas coherentes, puntajes/rachas esperados, ranking e historial**. Se perfilaron **4.305 sentencias** frente a **43.880** de referencia (90,2 % menos), con **30 lotes y 900 filas** de puntajes. Las respuestas intermedias usaron 4 sentencias (5 con enrutamiento) y **cero snapshots completos**; los 30 snapshots de respuesta corresponden a la única carga de cada cierre. El ACK máximo quedó en **1,4 y 2,9 s**, ambos por debajo de 8 s.

**El control de +50 ms sigue incumpliendo el presupuesto de 8 s.** No hubo rechazos de dominio ni pérdida de datos: PostgreSQL confirmó 60/60 respuestas, 30 resultados y todos los invariantes de puntuación en ambas repeticiones. Lo que falló fue la **entrega del ACK dentro de 8 s** para dos envíos por repetición. El patrón observado es el último ticket de la cola (jugador 29) en ambas rondas: 30 respuestas serializadas, cada una con ~5 sentencias afectadas por 50 ms artificiales, rozan el límite. No se aisló formalmente como única causa ni se extrapola a una red real. No se aumentó el timeout ni se declara aprobado este caso.

La primera tanda conservó un fallo adicional: una partida 30×30 con **60 timeouts**, aunque también terminó con 900/900 filas y 30 resultados. La segunda muestra inicial y ambas finales pasaron; esa variación local no se oculta ni se usa para borrar el fallo. La integridad de datos y el presupuesto de ACK se reportan por separado.

Ningún resultado local se presenta como garantía de capacidad en Railway, varias réplicas o hardware separado. Esas verificaciones siguen fuera de este cambio.
