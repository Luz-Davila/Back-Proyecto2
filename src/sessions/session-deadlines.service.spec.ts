import { ManualSessionClock } from '../../test/support/session-fixtures';
import { SessionDeadlinesService } from './session-deadlines.service';
import type { SessionLifecycleService } from './session-lifecycle.service';
import type { SessionsRepository } from './sessions.repository';

describe('Procesador recuperable de plazos', () => {
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
