import { createSessionFixture } from '../../test/support/session-fixtures';
import { SessionNotifications } from './session-notifications';
import type { SessionStateProjector } from './session-state.projector';
import type { SessionAggregate } from './session-aggregate';
import { SessionCoordinator } from './session-coordinator';

function snapshot(): SessionAggregate {
  const fixture = createSessionFixture();
  return {
    session: fixture.session,
    participants: [fixture.participant],
    questions: fixture.questions,
    answers: [],
    results: [],
  };
}

describe('Streams y proyección posterior al commit', () => {
  it('consulta no aumenta secuencia; un stream nuevo no reutiliza generación', async () => {
    const aggregate = snapshot();
    const notifications = new SessionNotifications({} as SessionStateProjector);
    const initial = notifications.current(aggregate);
    expect(notifications.current(aggregate).position).toEqual(initial.position);
    const after = structuredClone(aggregate);
    after.session.status = 'FINISHED';
    const changed = await notifications.committed(aggregate, after);
    expect(changed.position.sequence).toBe(initial.position.sequence + 1);
    expect(changed.event).toBe('game:finished');
    expect((await notifications.committed(after, after)).changed).toBe(false);
    notifications.onModuleDestroy();
    const restarted = new SessionNotifications({} as SessionStateProjector);
    expect(restarted.current(after).position.streamId).not.toBe(
      initial.position.streamId,
    );
  });

  it('comparte una proyección y acota espera/aborta firma sin filtrar datos', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const project = jest.fn((_aggregate: unknown, abort: AbortSignal) => {
      signal = abort;
      return new Promise<never>((_resolve, reject) =>
        abort.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });
    const notifications = new SessionNotifications({
      project,
    } as unknown as SessionStateProjector);
    try {
      const change = notifications.current(snapshot());
      const first = notifications.envelope(change);
      expect(notifications.envelope(change)).toBe(first);
      const rejected = expect(first).rejects.toThrow();
      await jest.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(signal?.aborted).toBe(true);
      expect(project).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('serializa una sala sin detener otras y libera la cola después de un fallo', async () => {
    const coordinator = new SessionCoordinator();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const first = coordinator.run('a', async () => {
      await gate;
      order.push('a1');
    });
    const second = coordinator.run('a', () => {
      order.push('a2');
      return Promise.resolve();
    });
    await coordinator.run('b', () => {
      order.push('b');
      return Promise.resolve();
    });
    expect(order).toEqual(['b']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['b', 'a1', 'a2']);
    await expect(
      coordinator.run('a', () => Promise.reject(new Error('failure'))),
    ).rejects.toThrow('failure');
    await expect(
      coordinator.run('a', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    await coordinator.onModuleDestroy();
  });
});
