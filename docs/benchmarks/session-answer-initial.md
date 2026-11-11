# Benchmark de respuestas

Revisión: 4ce9c9e84ff4c6e711ed375d689ac046b86ce5a2; dirty: true; fuente SHA-256: a6fb2a02debf94938b8c32d1e0248aba94121187579e44513a424ae046087e80.

Una instancia local; PostgreSQL loopback exclusivo; JWT/Storage/telemetría locales; 30 sockets reales, sin navegador ni tráfico externo. Retardo artificial por sentencia perfilada, incluidos BEGIN/COMMIT. Sin otras cargas de pruebas.

| Caso | Repetición | Resultado | Respuestas | ACK p95 / máx ms | >8 s | Consultas | Lotes / filas | Limpio |
|---|---:|---|---:|---:|---:|---:|---:|---|
| 30x3 | 1 | PASS | 90 | 969.72 / 1144.54 | 0 | 444 | 3 / 90 | true |
| 30x3 | 2 | PASS | 90 | 2808 / 3079.23 | 0 | 444 | 3 / 90 | true |
| 30x30 | 1 | FAIL | 900 | 8004.29 / 8013.29 | 60 | 4256 | 30 / 900 | true |
| 30x30 | 2 | PASS | 900 | 700.95 / 1134.56 | 0 | 4305 | 30 / 900 | true |
| 20ms | 1 | PASS | 60 | 3762.67 / 4300.75 | 0 | 294 | 2 / 60 | true |
| 20ms | 2 | PASS | 60 | 3774.7 / 4338.96 | 0 | 294 | 2 / 60 | true |
| 50ms | 1 | FAIL | 60 | 7205.02 / 8004.45 | 2 | 294 | 2 / 60 | true |
| 50ms | 2 | FAIL | 60 | 7393.79 / 8018.61 | 2 | 294 | 2 / 60 | true |
