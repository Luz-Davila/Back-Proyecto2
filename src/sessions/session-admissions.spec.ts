import { SessionAdmissions } from './session-admissions';
import { SessionCoordinator } from './session-coordinator';
import { GameTelemetry } from './game-telemetry';
import { ManualSessionClock } from '../../test/support/session-fixtures';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('SessionAdmissions', () => {
  it('registra fecha antes de esperar, mantiene FIFO y comparte solo la ruta activa', async () => {
    const clock = new ManualSessionClock();
    const admissions = new SessionAdmissions(clock);
    const blocked = gate();
    const entered = gate();
    const route = jest.fn(async () => 'room');
    const order: number[] = [];
    const firstAt = clock.now();
    const first = admissions.run('q', route, async (ticket) => {
      order.push(1);
      expect(ticket.answeredAt).toEqual(firstAt);
      entered.release();
      await blocked.promise;
      return ticket.resolveSession();
    });
    await entered.promise;
    clock.advance(1);
    const secondAt = clock.now();
    const second = admissions.run('q', route, async (ticket) => {
      expect(ticket.answeredAt).toEqual(secondAt);
      order.push(2);
      return ticket.resolveSession();
    });
    clock.advance(30_001);
    const deadline = admissions.run('q', route, async () => {
      order.push(3);
    });
    expect(order).toEqual([1]);
    blocked.release();
    expect(await first).toBe('room');
    expect(await second).toBe('room');
    await deadline;
    expect(order).toEqual([1, 2, 3]);
    expect(route).toHaveBeenCalledTimes(1);
    await admissions.run('q', route, (ticket) => ticket.resolveSession());
    expect(route).toHaveBeenCalledTimes(2);
    await admissions.close();
  });

  it('libera tras errores de trabajo/ruta y no bloquea otras preguntas', async () => {
    const admissions = new SessionAdmissions(new ManualSessionClock());
    const blocked = gate();
    const first = admissions.run(
      'q',
      async () => 'room',
      async () => {
        await blocked.promise;
        throw new Error('rollback');
      },
    );
    const rejected = expect(first).rejects.toThrow('rollback');
    const second = admissions.run(
      'q',
      async () => 'room',
      async () => 2,
    );
    await expect(
      admissions.run(
        'other',
        async () => 'other-room',
        async () => 3,
      ),
    ).resolves.toBe(3);
    blocked.release();
    await rejected;
    await expect(second).resolves.toBe(2);
    await expect(
      admissions.run(
        'q',
        async () => {
          throw new Error('route');
        },
        (t) => t.resolveSession(),
      ),
    ).rejects.toThrow('route');
    await expect(
      admissions.run(
        'q',
        async () => 'new',
        (t) => t.resolveSession(),
      ),
    ).resolves.toBe('new');
    await admissions.close();
  });

  it('shutdown drena admisiones antes de detener la coordinación de sala', async () => {
    const admissions = new SessionAdmissions(new ManualSessionClock());
    const telemetry = new GameTelemetry();
    const wait = jest.spyOn(telemetry, 'queueWait');
    const coordinator = new SessionCoordinator(telemetry, admissions);
    const blocked = gate();
    const work = admissions.run(
      'q',
      async () => 'room',
      async (ticket) => {
        await blocked.promise;
        return coordinator.run(
          await ticket.resolveSession(),
          async () => 7,
          100,
        );
      },
    );
    let stopped = false;
    const closing = coordinator.onModuleDestroy().then(() => {
      stopped = true;
    });
    await expect(
      admissions.run(
        'q',
        async () => 'room',
        async () => 0,
      ),
    ).rejects.toThrow('stopping');
    expect(stopped).toBe(false);
    blocked.release();
    await expect(work).resolves.toBe(7);
    await closing;
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait.mock.calls[0][0]).toBeGreaterThanOrEqual(0.1);
    await expect(coordinator.run('room', async () => 0)).rejects.toThrow(
      'stopping',
    );
    telemetry.onModuleDestroy();
  });
});
