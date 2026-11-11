import { Injectable } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { SessionClock } from './session.clock';

interface QuestionQueue {
  tail: Promise<void>;
  route?: Promise<string>;
}

export interface AnswerAdmission {
  readonly answeredAt: Date;
  readonly waitMs: number;
  resolveSession(): Promise<string>;
}

/** Process-local admission ordering, not authorization or a durable message queue. */
@Injectable()
export class SessionAdmissions {
  private readonly questions = new Map<string, QuestionQueue>();
  private stopping = false;

  constructor(private readonly clock: SessionClock) {}

  run<T>(
    questionId: string,
    resolveSession: () => Promise<string>,
    work: (admission: AnswerAdmission) => Promise<T>,
  ): Promise<T> {
    if (this.stopping)
      return Promise.reject(new Error('Admissions are stopping'));
    // Registration and the trusted date MUST precede the first await/DB lookup.
    const answeredAt = this.clock.now();
    const waiting = performance.now();
    const queue = this.questions.get(questionId) ?? { tail: Promise.resolve() };
    const previous = queue.tail;
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    queue.tail = tail;
    this.questions.set(questionId, queue);
    return (async () => {
      await previous;
      try {
        return await work({
          answeredAt,
          waitMs: performance.now() - waiting,
          resolveSession: () => (queue.route ??= resolveSession()),
        });
      } finally {
        release();
        if (queue.tail === tail) this.questions.delete(questionId);
      }
    })();
  }

  /** Called by the room coordinator before it stops, so queued work can drain. */
  async close(): Promise<void> {
    this.stopping = true;
    await Promise.all([...this.questions.values()].map((queue) => queue.tail));
  }
}
