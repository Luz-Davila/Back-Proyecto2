import {
  Inject,
  Injectable,
  OnModuleDestroy,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import {
  metrics,
  type Meter,
  type ObservableResult,
  type Counter,
  type Histogram,
  type ObservableGauge,
} from '@opentelemetry/api';
import { performance } from 'node:perf_hooks';
import {
  SESSION_COMMANDS,
  type SessionAck,
} from './realtime/session-realtime.contracts';
import { SESSION_ERRORS, SessionError } from './session.error';

export const GAME_METER = Symbol('GAME_METER');
export const GAME_INSTRUMENTS = {
  commands: 'profelink.game.commands',
  commandDuration: 'profelink.game.command.duration',
  answers: 'profelink.game.answers',
  recovery: 'profelink.game.recovery.requests',
  queueWait: 'profelink.game.queue.wait',
  deadlineLag: 'profelink.game.deadline.lag',
  notificationFailures: 'profelink.game.notification.failures',
  connections: 'profelink.game.connections',
} as const;
type RecoveryOperation = 'state_by_code' | 'room_join' | 'room_subscribe';
type RecoveryOutcome = 'created' | 'recovered' | 'rejected' | 'error';

/** Best-effort process observations: never an authority for game decisions. */
@Injectable()
export class GameTelemetry implements OnModuleDestroy {
  private readonly meter: Meter;
  private readonly commands: Counter;
  private readonly duration: Histogram;
  private readonly answers: Counter;
  private readonly recoveryRequests: Counter;
  private readonly queue: Histogram;
  private readonly deadlines: Histogram;
  private readonly notifications: Counter;
  private readonly connections: ObservableGauge;
  private readonly live = new Map<object, () => boolean>();
  private readonly observeConnections = (result: ObservableResult) =>
    this.safe(() => result.observe(this.connectionCount()));

  constructor(@Optional() @Inject(GAME_METER) meter?: Meter) {
    this.meter = meter ?? metrics.getMeter('profelink-game');
    this.commands = this.meter.createCounter(GAME_INSTRUMENTS.commands, {
      unit: '{command}',
    });
    this.duration = this.meter.createHistogram(
      GAME_INSTRUMENTS.commandDuration,
      { unit: 's' },
    );
    this.answers = this.meter.createCounter(GAME_INSTRUMENTS.answers, {
      unit: '{submission}',
    });
    this.recoveryRequests = this.meter.createCounter(
      GAME_INSTRUMENTS.recovery,
      { unit: '{request}' },
    );
    this.queue = this.meter.createHistogram(GAME_INSTRUMENTS.queueWait, {
      unit: 's',
    });
    this.deadlines = this.meter.createHistogram(GAME_INSTRUMENTS.deadlineLag, {
      unit: 's',
    });
    this.notifications = this.meter.createCounter(
      GAME_INSTRUMENTS.notificationFailures,
      { unit: '{failure}' },
    );
    this.connections = this.meter.createObservableGauge(
      GAME_INSTRUMENTS.connections,
      { unit: '{connection}' },
    );
    this.safe(() => this.connections.addCallback(this.observeConnections));
  }

  private safe(work: () => void): void {
    try {
      work();
    } catch {
      /* Telemetry must not change the result. */
    }
  }
  private code(value: string): string {
    return value === 'NONE' ||
      value === 'EVENT_NOT_SUPPORTED' ||
      Object.hasOwn(SESSION_ERRORS, value)
      ? value
      : 'INTERNAL_ERROR';
  }
  failure(error: unknown): string {
    return error instanceof SessionError
      ? error.code
      : error instanceof UnauthorizedException
        ? 'UNAUTHORIZED'
        : 'INTERNAL_ERROR';
  }
  private outcome(code: string): 'rejected' | 'error' {
    return code === 'INTERNAL_ERROR' ? 'error' : 'rejected';
  }
  command(
    event: string,
    ack: SessionAck,
    started: number,
    created = false,
  ): void {
    const command = (SESSION_COMMANDS as readonly string[]).includes(event)
      ? event
      : 'unsupported';
    const code = ack.ok ? 'NONE' : this.code(ack.error.code);
    const attrs = {
      command,
      code,
      outcome: ack.ok ? 'success' : this.outcome(code),
    };
    this.safe(() => this.commands.add(1, attrs));
    this.safe(() =>
      this.duration.record(
        Math.max(0, performance.now() - started) / 1000,
        attrs,
      ),
    );
    if (event === 'room:join' || event === 'room:subscribe') {
      this.recovery(
        event === 'room:join' ? 'room_join' : 'room_subscribe',
        ack.ok ? (created ? 'created' : 'recovered') : this.outcome(code),
        code,
      );
    }
  }
  answer(
    outcome: 'accepted' | 'replayed' | 'rejected' | 'error',
    code = 'NONE',
  ): void {
    this.safe(() => this.answers.add(1, { outcome, code: this.code(code) }));
  }
  answerFailed(error: unknown): void {
    const code = this.failure(error);
    this.answer(this.outcome(code), code);
  }
  recovery(
    operation: RecoveryOperation,
    outcome: RecoveryOutcome,
    code = 'NONE',
  ): void {
    this.safe(() =>
      this.recoveryRequests.add(1, {
        operation,
        outcome,
        code: this.code(code),
      }),
    );
  }
  httpRecovery(status: number, finished: boolean): void {
    const code = !finished
      ? 'INTERNAL_ERROR'
      : status === 200
        ? 'NONE'
        : status === 400
          ? 'VALIDATION_ERROR'
          : status === 401
            ? 'UNAUTHORIZED'
            : status === 404
              ? 'SESSION_NOT_FOUND'
              : 'INTERNAL_ERROR';
    this.recovery(
      'state_by_code',
      code === 'NONE' ? 'recovered' : this.outcome(code),
      code,
    );
  }
  queueWait(seconds: number): void {
    this.safe(() => this.queue.record(Math.max(0, seconds)));
  }
  deadlineLag(kind: 'ANSWER' | 'REVIEW', milliseconds: number): void {
    this.safe(() =>
      this.deadlines.record(Math.max(0, milliseconds) / 1000, { kind }),
    );
  }
  notificationFailure(stage: 'projection' | 'delivery'): void {
    this.safe(() => this.notifications.add(1, { stage }));
  }
  connected(key: object, alive: () => boolean): void {
    this.live.set(key, alive);
  }
  disconnected(key: object): void {
    this.live.delete(key);
  }
  connectionCount(): number {
    let count = 0;
    for (const alive of this.live.values()) {
      try {
        if (alive()) count++;
      } catch {
        /* A closed socket contributes zero. */
      }
    }
    return count;
  }
  onModuleDestroy(): void {
    this.live.clear();
    this.safe(() => this.connections.removeCallback(this.observeConnections));
  }
}
