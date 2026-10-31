import { performance } from 'node:perf_hooks';
import { gameMetrics } from '../../test/support/game-metric-reader';
import { GAME_INSTRUMENTS, GameTelemetry } from './game-telemetry';
import { SessionError } from './session.error';
import { SessionCoordinator } from './session-coordinator';
import { TELEMETRY_PRIVACY } from '../telemetry-privacy';
import { TelemetryLifecycle, registerTelemetry } from '../telemetry-lifecycle';

describe('Métricas de juego con receptor local', () => {
  it('catálogo, unidades, normalización y gauge no confunden sockets con jugadores', async () => {
    const m = gameMetrics();
    try {
      m.telemetry.command(
        'unknown-secret',
        {
          ok: false,
          error: { code: 'random-secret', message: 'token-secret' },
        },
        performance.now() - 25,
      );
      m.telemetry.answer('accepted');
      m.telemetry.answer('replayed');
      m.telemetry.answerFailed(new SessionError('ANSWER_TOO_LATE'));
      m.telemetry.recovery('room_join', 'created');
      m.telemetry.recovery('room_join', 'recovered');
      m.telemetry.queueWait(0.3);
      m.telemetry.deadlineLag('ANSWER', 2000);
      m.telemetry.notificationFailure('projection');
      const a = {},
        b = {};
      m.telemetry.connected(a, () => true);
      m.telemetry.connected(b, () => true);
      expect(m.telemetry.connectionCount()).toBe(2);
      m.telemetry.disconnected(a);
      const points = await m.reader.points();
      expect(new Set(points.map((p) => p.name))).toEqual(
        new Set(Object.values(GAME_INSTRUMENTS)),
      );
      expect(
        points.find((p) => p.name === GAME_INSTRUMENTS.commands),
      ).toMatchObject({
        attributes: {
          command: 'unsupported',
          code: 'INTERNAL_ERROR',
          outcome: 'error',
        },
        value: 1,
      });
      expect(
        points.find((p) => p.name === GAME_INSTRUMENTS.connections),
      ).toMatchObject({ value: 1 });
      expect(
        points.find((p) => p.name === GAME_INSTRUMENTS.deadlineLag),
      ).toMatchObject({ unit: 's', value: { count: 1, sum: 2 } });
      expect(JSON.stringify(points)).not.toMatch(
        /unknown-secret|random-secret|token-secret/,
      );
    } finally {
      m.telemetry.onModuleDestroy();
      await m.provider.shutdown();
    }
  });

  it('espera de cola es monotónica, sin incluir ejecución ni bloquear otra sala', async () => {
    const m = gameMetrics();
    const queue = new SessionCoordinator(m.telemetry);
    try {
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const one = queue.run('secret-room', () => barrier);
      const two = queue.run('secret-room', () => Promise.resolve());
      await queue.run('other-room', () => Promise.resolve());
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      release();
      await Promise.all([one, two]);
      const point = (await m.reader.points()).find(
        (p) => p.name === GAME_INSTRUMENTS.queueWait,
      );
      expect(point).toMatchObject({
        unit: 's',
        attributes: {},
        value: { count: 3 },
      });
      expect(JSON.stringify(point)).not.toContain('secret-room');
    } finally {
      await queue.onModuleDestroy();
      m.telemetry.onModuleDestroy();
      await m.provider.shutdown();
    }
  });

  it('sin proveedor exportador el juego no requiere red; cierre es idempotente', async () => {
    const telemetry = new GameTelemetry();
    telemetry.answer('accepted');
    telemetry.queueWait(0);
    telemetry.onModuleDestroy();
    const shutdown = jest.fn().mockRejectedValue(new Error('offline'));
    registerTelemetry({ shutdown });
    const lifecycle = new TelemetryLifecycle();
    await lifecycle.onApplicationShutdown();
    await lifecycle.onApplicationShutdown();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(
      TELEMETRY_PRIVACY['@opentelemetry/instrumentation-http'].enabled,
    ).toBe(false);
    expect(TELEMETRY_PRIVACY['@opentelemetry/instrumentation-pg'].enabled).toBe(
      false,
    );
  });

  it('errores de instrumento no se convierten en errores del juego', async () => {
    const m = gameMetrics();
    try {
      // A failing SDK instrument is swallowed at the facade boundary.
      const meter = m.provider.getMeter('failure');
      jest.spyOn(meter, 'createCounter').mockReturnValue({
        add: () => {
          throw new Error('exporter');
        },
      });
      const telemetry = new GameTelemetry(meter);
      expect(() => telemetry.answer('accepted')).not.toThrow();
      telemetry.onModuleDestroy();
    } finally {
      m.telemetry.onModuleDestroy();
      await m.provider.shutdown();
    }
  });
});
