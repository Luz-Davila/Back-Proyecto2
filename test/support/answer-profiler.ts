import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { DataSource } from 'typeorm';
import type { SessionsRepository } from '../../src/sessions/sessions.repository';
import type { SessionCoordinator } from '../../src/sessions/session-coordinator';
import type { SessionAnswersService } from '../../src/sessions/session-answers.service';
import type { SessionLifecycleService } from '../../src/sessions/session-lifecycle.service';

export interface AnswerProfileRecord {
  type: string;
  durationMs: number;
  queueMs: number;
  queries: number;
  sqlMs: number;
  artificialMs: number;
  snapshots: number;
  snapshotAnswerRows: number;
  scoreBatches: number;
  scoreRows: number;
  groups: Record<string, number>;
  error: string | null;
}

/** Opt-in, instance-scoped instrumentation. No SQL, values, IDs or tokens leave it. */
export class AnswerProfiler {
  private readonly storage = new AsyncLocalStorage<AnswerProfileRecord>();
  private records: AnswerProfileRecord[] = [];
  private latencyMs = 0;
  private active = 0;
  private peak = 0;

  reset(latencyMs = 0) {
    if (this.active) throw new Error('Hay operaciones perfiladas activas');
    if (![0, 20, 50].includes(latencyMs))
      throw new Error('Retardo no permitido');
    this.records = [];
    this.latencyMs = latencyMs;
    this.peak = 0;
  }

  read() {
    return {
      records: this.records,
      active: this.active,
      peak: this.peak,
      latencyMs: this.latencyMs,
    };
  }

  private async operation<T>(type: string, work: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) return work();
    const record: AnswerProfileRecord = {
      type,
      durationMs: 0,
      queueMs: 0,
      queries: 0,
      sqlMs: 0,
      artificialMs: 0,
      snapshots: 0,
      snapshotAnswerRows: 0,
      scoreBatches: 0,
      scoreRows: 0,
      groups: {},
      error: null,
    };
    this.active++;
    this.peak = Math.max(this.peak, this.active);
    return this.storage.run(record, async () => {
      const started = performance.now();
      try {
        return await work();
      } catch (error) {
        record.error =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'INTERNAL';
        throw error;
      } finally {
        record.durationMs = performance.now() - started;
        this.records.push(record);
        this.active--;
      }
    });
  }

  install(
    ds: DataSource,
    repository: SessionsRepository,
    coordinator: SessionCoordinator,
    answers: SessionAnswersService,
    lifecycle: SessionLifecycleService,
  ) {
    const createRunner = ds.createQueryRunner.bind(ds);
    ds.createQueryRunner = (...args) => {
      const runner = createRunner(...args);
      const query = runner.query.bind(runner);
      runner.query = (async (
        sql: string,
        parameters?: unknown[],
        structured?: boolean,
      ) => {
        const record = this.storage.getStore();
        if (!record) return query(sql, parameters, structured);
        const started = performance.now();
        const verb = sql.trim().split(/\s+/)[0].toUpperCase();
        const table =
          sql.match(/(?:FROM|INTO|UPDATE)\s+(?:"[^"]+"\.)?"([^"]+)"/i)?.[1] ??
          'transaction';
        const group = `${verb} ${table}`;
        record.queries++;
        record.groups[group] = (record.groups[group] ?? 0) + 1;
        try {
          if (this.latencyMs) {
            record.artificialMs += this.latencyMs;
            await delay(this.latencyMs);
          }
          const result: unknown = await query(sql, parameters, structured);
          if (
            verb === 'UPDATE' &&
            table === 'answers' &&
            /SET\s+score\s*=/i.test(sql)
          ) {
            record.scoreBatches++;
            // TypeORM's raw PostgreSQL UPDATE returns [rows, affected].
            record.scoreRows +=
              Array.isArray(result) && typeof result[1] === 'number'
                ? result[1]
                : result && typeof result === 'object' && 'affected' in result
                  ? Number(result.affected)
                  : 0;
          }
          return result;
        } finally {
          record.sqlMs += performance.now() - started;
        }
      }) as typeof runner.query;
      return runner;
    };
    const run = coordinator.run.bind(coordinator);
    coordinator.run = (id, work, previousWaitMs = 0) => {
      const record = this.storage.getStore();
      const started = performance.now();
      return run(
        id,
        () => {
          if (record)
            record.queueMs += previousWaitMs + performance.now() - started;
          return work();
        },
        previousWaitMs,
      );
    };
    const snapshot = repository.snapshot.bind(repository);
    repository.snapshot = async (...args) => {
      const result = await snapshot(...args);
      const record = this.storage.getStore();
      if (record) {
        record.snapshots++;
        record.snapshotAnswerRows += result.answers.length;
      }
      return result;
    };
    const submit = answers.submit.bind(answers);
    answers.submit = (...args) =>
      this.operation('answer', () => submit(...args));
    const start = lifecycle.start.bind(lifecycle);
    lifecycle.start = (...args) =>
      this.operation('start', () => start(...args));
    const finish = lifecycle.finish.bind(lifecycle);
    lifecycle.finish = (...args) =>
      this.operation('finish', () => finish(...args));
    const advance = lifecycle.advance.bind(lifecycle);
    lifecycle.advance = (...args) =>
      this.operation('advance', () => advance(...args));
    const deadline = lifecycle.processDeadline.bind(lifecycle);
    lifecycle.processDeadline = (...args) =>
      this.operation(`deadline:${args[0].kind}`, () => deadline(...args));
  }
}

export interface AnswerProfile {
  records: AnswerProfileRecord[];
  active: number;
  peak: number;
  latencyMs: number;
}
