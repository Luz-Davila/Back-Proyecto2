import {
  evaluateLevel,
  highestPassedLevel,
  parseDemoOptions,
  percentiles,
  reportMarkdown,
  type DemoLevel,
} from '../../test/support/demo-report';
const args = [
  '--levels=4,8',
  '--seconds=3',
  '--ack-timeout-ms=10000',
  '--p95-ms=1000',
  '--p99-ms=2000',
];
const options = parseDemoOptions(args);
function level(): DemoLevel {
  return {
    players: 4,
    targetSockets: 7,
    minObservedSockets: 7,
    peakObservedSockets: 7,
    durationMs: 3000,
    warmupMs: 100,
    commands: 100,
    expectedRejections: 4,
    unexpectedErrors: 0,
    timeouts: 0,
    ackLatencyMs: percentiles([10, 20, 30]),
    invariantFailures: [],
    passed: false,
    reason: '',
  };
}
describe('Evaluación honesta de demostración multiusuario', () => {
  it('valida configuración antes de crear recursos', () => {
    expect(options.levels).toEqual([4, 8]);
    expect(() => parseDemoOptions([])).toThrow();
    expect(() => parseDemoOptions([...args, '--url=https://prod'])).toThrow();
    expect(() =>
      parseDemoOptions(
        args.map((v) => (v === '--levels=4,8' ? '--levels=999' : v)),
      ),
    ).toThrow();
  });
  it('aprueba solo concurrencia observada mantenida, no el pico solicitado', () => {
    const passed = evaluateLevel(level(), options);
    expect(passed.passed).toBe(true);
    expect(highestPassedLevel([passed])).toBe(4);
    expect(
      evaluateLevel(
        { ...level(), minObservedSockets: 6, peakObservedSockets: 100 },
        options,
      ).passed,
    ).toBe(false);
  });
  it.each([
    { timeouts: 1 },
    { unexpectedErrors: 1 },
    { durationMs: 20 },
    { minObservedSockets: null },
    { ackLatencyMs: percentiles([]) },
    { ackLatencyMs: percentiles([9000]) },
    { invariantFailures: ['duplicate'] },
  ])('rechaza datos incompletos o incumplidos %j', (override) => {
    const result = evaluateLevel({ ...level(), ...override }, options);
    expect(result.passed).toBe(false);
    expect(highestPassedLevel([result])).toBeNull();
  });
  it('reporta ausencia de resultados y diferidos sin fabricar capacidad', () => {
    expect(highestPassedLevel([])).toBeNull();
    const markdown = reportMarkdown({
      date: 'test',
      options,
      levels: [],
      highestPassedLevel: null,
      environment: { cpuUsage: null },
    });
    expect(markdown).toContain('ninguno');
    expect(markdown).toContain('Grafana');
    expect(markdown).toContain('no medidos');
  });
});
