# Benchmark de respuestas

Revisión: 4ce9c9e84ff4c6e711ed375d689ac046b86ce5a2; dirty: true; fuente SHA-256: 1761fdd33f41cae85c6ca6c3271dac4063820e60b0545fd40dde0915652cddcf.

Una instancia local; PostgreSQL loopback exclusivo; JWT/Storage/telemetría locales; 30 sockets reales, sin navegador ni tráfico externo. Retardo artificial por sentencia perfilada, incluidos BEGIN/COMMIT. Sin otras cargas de pruebas.

| Caso | Repetición | Resultado | Respuestas | ACK p95 / máx ms | >8 s | Consultas | Lotes / filas | Limpio |
|---|---:|---|---:|---:|---:|---:|---:|---|
| 30x3 | 1 | PASS | 90 | 534.11 / 727.19 | 0 | 444 | 3 / 90 | true |
| 30x3 | 2 | PASS | 90 | 420.58 / 500.45 | 0 | 444 | 3 / 90 | true |
| 30x30 | 1 | PASS | 900 | 636.71 / 1402.64 | 0 | 4305 | 30 / 900 | true |
| 30x30 | 2 | PASS | 900 | 873.82 / 2925.48 | 0 | 4305 | 30 / 900 | true |
| 20ms | 1 | PASS | 60 | 3817.34 / 4524.52 | 0 | 294 | 2 / 60 | true |
| 20ms | 2 | PASS | 60 | 3610.89 / 4069.32 | 0 | 294 | 2 / 60 | true |
| 50ms | 1 | FAIL | 60 | 7540.28 / 8005.88 | 2 | 294 | 2 / 60 | true |
| 50ms | 2 | FAIL | 60 | 7506.15 / 8014.73 | 2 | 294 | 2 / 60 | true |
