import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { GameTelemetry } from './game-telemetry';
import { SessionAdmissions } from './session-admissions';

/** Local publication/subscription ordering. Database locks remain authoritative. */
@Injectable()
export class SessionCoordinator implements OnModuleDestroy {
  private readonly tails = new Map<string, Promise<void>>();
  private stopping = false;
  constructor(
    @Optional() private readonly telemetry?: GameTelemetry,
    @Optional() private readonly admissions?: SessionAdmissions,
  ) {}

  async run<T>(
    sessionId: string,
    work: () => Promise<T>,
    previousWaitMs = 0,
  ): Promise<T> {
    if (this.stopping) throw new Error('Session coordinator is stopping');
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const barrier = new Promise<void>((done) => {
      release = done;
    });
    this.tails.set(sessionId, barrier);
    const waiting = performance.now();
    await previous;
    this.telemetry?.queueWait(
      (previousWaitMs + performance.now() - waiting) / 1000,
    );
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(sessionId) === barrier) this.tails.delete(sessionId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.admissions?.close();
    this.stopping = true;
    await Promise.all(this.tails.values());
  }
}
