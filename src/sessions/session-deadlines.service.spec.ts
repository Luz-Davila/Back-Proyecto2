import { ManualSessionClock } from '../../test/support/session-fixtures';
import { SessionDeadlinesService } from './session-deadlines.service';
import type { SessionLifecycleService } from './session-lifecycle.service';
import type { SessionsRepository } from './sessions.repository';

describe('Procesador recuperable de plazos', () => {
  it('una sala esperando admisiones no retiene los plazos de otra sala', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      secondEntered = resolve;
    });
    const jobs = ['first', 'second'].map((sessionId) => ({ sessionId }));
    const repository = { dueDeadlines: jest.fn().mockResolvedValue(jobs) };
    const lifecycle = {
      processDeadline: jest.fn(async (command: { sessionId: string }) => {
        if (command.sessionId === 'first') await blocked;
        else secondEntered();
      }),
    };
    const worker = new SessionDeadlinesService(
      repository as unknown as SessionsRepository,
      lifecycle as unknown as SessionLifecycleService,
      new ManualSessionClock(),
    );
    const tick = worker.tick();
    try {
      await entered;
      expect(lifecycle.processDeadline).toHaveBeenCalledTimes(2);
      expect(worker.tick()).toBe(tick);
    } finally {
      release();
      await tick;
      await worker.onModuleDestroy();
    }
  });

  it('recupera al iniciar, procesa sin host conectado y limpia temporizadores', async () => {
    jest.useFakeTimers();
    const job = {
      sessionId: 'room',
      expectedQuestionId: 'question',
      kind: 'ANSWER',
      expectedDeadline: new Date(),
    };
    const repository = { dueDeadlines: jest.fn().mockResolvedValue([job]) };
    const lifecycle = {
      processDeadline: jest.fn().mockResolvedValue(undefined),
    };
    const worker = new SessionDeadlinesService(
      repository as unknown as SessionsRepository,
      lifecycle as unknown as SessionLifecycleService,
      new ManualSessionClock(),
    );
    try {
      await worker.onModuleInit();
      expect(lifecycle.processDeadline).toHaveBeenCalledWith(job);
      await jest.advanceTimersByTimeAsync(250);
      expect(repository.dueDeadlines).toHaveBeenCalledTimes(2);
      await worker.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1000);
      expect(repository.dueDeadlines).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await worker.onModuleDestroy();
      jest.useRealTimers();
    }
  });
});
