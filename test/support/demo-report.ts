export interface DemoOptions {
  levels: number[];
  seconds: number;
  ackTimeoutMs: number;
  p95Ms: number;
  p99Ms: number;
}
export interface DemoLevel {
  players: number;
  targetSockets: number;
  minObservedSockets: number | null;
  peakObservedSockets: number;
  durationMs: number;
  warmupMs: number;
  commands: number;
  expectedRejections: number;
  unexpectedErrors: number;
  timeouts: number;
  ackLatencyMs: {
    samples: number;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  invariantFailures: string[];
  passed: boolean;
  reason: string;
}
export function parseDemoOptions(args: string[]): DemoOptions {
  const allowed = ['levels', 'seconds', 'ack-timeout-ms', 'p95-ms', 'p99-ms'];
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--([a-z0-9-]+)=(.+)$/.exec(arg);
    if (!match || !allowed.includes(match[1]) || values.has(match[1]))
      throw new Error(
        'Usa flags únicos --levels=4,8 --seconds=3 --ack-timeout-ms=10000 --p95-ms=1000 --p99-ms=2000',
      );
    values.set(match[1], match[2]);
  }
  if (allowed.some((key) => !values.has(key)))
    throw new Error('Todos los presupuestos y niveles deben ser explícitos');
  const integer = (value: string | undefined, min: number, max: number) => {
    const parsed = Number(value);
    if (
      !/^\d+$/.test(value ?? '') ||
      !Number.isInteger(parsed) ||
      parsed < min ||
      parsed > max
    )
      throw new Error('Parámetro fuera de límites');
    return parsed;
  };
  const levels = values
    .get('levels')!
    .split(',')
    .map((v) => integer(v, 4, 64));
  if (
    levels.length > 4 ||
    levels.some((n, i) => n % 2 !== 0 || (i > 0 && n <= levels[i - 1]))
  )
    throw new Error(
      'Hasta cuatro niveles pares, ascendentes, de 4 a 64 jugadores',
    );
  const options = {
    levels,
    seconds: integer(values.get('seconds'), 1, 60),
    ackTimeoutMs: integer(values.get('ack-timeout-ms'), 500, 30000),
    p95Ms: integer(values.get('p95-ms'), 1, 30000),
    p99Ms: integer(values.get('p99-ms'), 1, 30000),
  };
  if (options.p95Ms > options.p99Ms || options.p99Ms > options.ackTimeoutMs)
    throw new Error('Se exige p95 <= p99 <= timeout');
  return options;
}
export function percentiles(values: number[]): DemoLevel['ackLatencyMs'] {
  const sorted = values
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]
      : null;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}
export function evaluateLevel(
  level: DemoLevel,
  options: DemoOptions,
): DemoLevel {
  const reasons = [...level.invariantFailures];
  if (
    level.minObservedSockets === null ||
    level.minObservedSockets < level.targetSockets
  )
    reasons.push('Concurrencia objetivo no mantenida');
  if (level.durationMs < options.seconds * 1000)
    reasons.push('Duración no alcanzada');
  if (level.unexpectedErrors || level.timeouts)
    reasons.push('Errores/timeouts inesperados');
  if (level.ackLatencyMs.p95 === null || level.ackLatencyMs.p99 === null)
    reasons.push('Latencia no disponible');
  else if (
    level.ackLatencyMs.p95 > options.p95Ms ||
    level.ackLatencyMs.p99 > options.p99Ms
  )
    reasons.push('Presupuesto de latencia excedido');
  return {
    ...level,
    passed: reasons.length === 0,
    reason: reasons.length
      ? reasons.join('; ')
      : 'Concurrencia, presupuestos e invariantes verificados',
  };
}
export function highestPassedLevel(levels: DemoLevel[]): number | null {
  const passed = levels.filter((l) => l.passed).map((l) => l.players);
  return passed.length ? Math.max(...passed) : null;
}
export function reportMarkdown(report: {
  date: string;
  options: DemoOptions;
  levels: DemoLevel[];
  highestPassedLevel: number | null;
  environment: unknown;
}): string {
  return `# Demostración local de sesiones\n\nFecha: ${report.date}\n\nModalidad: clientes simulados HTTP/Socket.IO, JWT locales, Storage simulado y PostgreSQL real local. No es demo física, VPS ni capacidad productiva.\n\nEntorno: \`${JSON.stringify(report.environment)}\`\n\nParámetros: \`${JSON.stringify(report.options)}\`\n\n| Jugadores | Sockets objetivo | Mínimo observado | Pico observado | Duración ms | Ack p95 ms | Ack p99 ms | Aprobado |\n|---|---|---|---|---|---|---|---|\n${report.levels.map((l) => `| ${l.players} | ${l.targetSockets} | ${l.minObservedSockets ?? 'N/D'} | ${l.peakObservedSockets} | ${l.durationMs.toFixed(0)} | ${l.ackLatencyMs.p95?.toFixed(2) ?? 'N/D'} | ${l.ackLatencyMs.p99?.toFixed(2) ?? 'N/D'} | ${l.passed ? 'Sí' : 'No'} |`).join('\n')}\n\nMayor nivel de jugadores probado y aprobado: **${report.highestPassedLevel ?? 'ninguno'}**. No se extrapola a producción.\n\n${report.levels.map((l) => `- Nivel ${l.players}: ${l.reason}. Comandos: ${l.commands}; rechazos esperados: ${l.expectedRejections}; errores inesperados: ${l.unexpectedErrors}; timeouts: ${l.timeouts}.`).join('\n')}\n\nPendientes externos: dispositivos físicos, reinicio de VPS y conexión/dashboards Grafana. CPU del backend y consumo de BD: no medidos.\n`;
}
