import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { GameTelemetry } from './game-telemetry';
import { randomUUID } from 'crypto';
import type { SessionAggregate } from './session-aggregate';
import { SessionStateProjector } from './session-state.projector';
import { sessionScoreboard } from './session-scoring';
import type {
  RoomEnvelope,
  StreamPosition,
  SessionEvent,
} from './realtime/session-realtime.contracts';

export interface CommittedSession {
  snapshot: SessionAggregate;
  position: StreamPosition;
  changed: boolean;
  removedUserIds: string[];
  event?: SessionEvent;
  scoreboardUpdated?: boolean;
  notificationStage?: 'projection' | 'delivery';
}
export type SessionCommitObserver<T> = (
  value: T,
  committed: CommittedSession,
) => Promise<void>;
export interface SessionNotificationSink {
  changed(committed: CommittedSession): Promise<void>;
}

@Injectable()
export class SessionNotifications implements OnModuleDestroy {
  private readonly logger = new Logger(SessionNotifications.name);
  private readonly streams = new Map<string, StreamPosition>();
  private readonly envelopes = new WeakMap<
    CommittedSession,
    Promise<RoomEnvelope>
  >();
  private sink?: SessionNotificationSink;

  constructor(
    private readonly projector: SessionStateProjector,
    @Optional() private readonly telemetry?: GameTelemetry,
  ) {}

  attach(sink: SessionNotificationSink): void {
    this.sink = sink;
  }
  detach(): void {
    this.sink = undefined;
  }
  onModuleDestroy(): void {
    this.detach();
    this.streams.clear();
  }

  current(snapshot: SessionAggregate): CommittedSession {
    let position = this.streams.get(snapshot.session.id);
    if (!position) {
      position = { streamId: randomUUID(), sequence: 0 };
      this.streams.set(snapshot.session.id, position);
    }
    return {
      snapshot: structuredClone(snapshot),
      position: { ...position },
      changed: false,
      removedUserIds: [],
    };
  }

  async committed(
    before: SessionAggregate,
    after: SessionAggregate,
  ): Promise<CommittedSession> {
    const committed = this.current(after);
    // Intermediate answers are private. Only their atomic close/scoring policy
    // changes the public room state and advances the stream.
    const publicChanges = (aggregate: SessionAggregate) =>
      JSON.stringify({
        session: aggregate.session,
        questions: aggregate.questions,
        participants: aggregate.participants,
        results: aggregate.results,
      });
    if (publicChanges(before) === publicChanges(after)) return committed;
    committed.changed = true;
    committed.position = {
      ...committed.position,
      sequence: committed.position.sequence + 1,
    };
    this.streams.set(after.session.id, committed.position);
    committed.scoreboardUpdated = after.questions.some(
      (q) =>
        q.scoredAt &&
        !before.questions.find((previous) => previous.id === q.id)?.scoredAt,
    );
    committed.removedUserIds = before.participants
      .filter(
        (p) => !after.participants.some((next) => next.userId === p.userId),
      )
      .map((p) => p.userId);
    const previous = before.questions.find(
      (q) => q.position === before.session.currentIndex,
    );
    const current = after.questions.find(
      (q) => q.position === after.session.currentIndex,
    );
    if (
      after.session.status === 'FINISHED' &&
      before.session.status !== 'FINISHED'
    ) {
      committed.event = 'game:finished';
    } else if (
      current?.status === 'OPEN' &&
      (previous?.id !== current.id || previous.status !== 'OPEN')
    ) {
      committed.event = 'question:opened';
    } else if (
      after.session.status === 'IN_PROGRESS' &&
      current?.status === 'CLOSED' &&
      (previous?.id !== current.id || previous.status !== 'CLOSED')
    ) {
      committed.event = 'question:closed';
    }
    try {
      await this.sink?.changed(committed);
    } catch {
      this.telemetry?.notificationFailure(
        committed.notificationStage ?? 'delivery',
      );
      this.logger.error(
        'Falló una notificación posterior al commit; recuperar mediante suscripción',
      );
    }
    return committed;
  }

  envelope(committed: CommittedSession): Promise<RoomEnvelope> {
    let envelope = this.envelopes.get(committed);
    if (!envelope) {
      envelope = this.project(committed);
      this.envelopes.set(committed, envelope);
    }
    return envelope;
  }

  private async project(committed: CommittedSession): Promise<RoomEnvelope> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    try {
      const state = await Promise.race([
        this.projector.project(committed.snapshot, abort.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new Error('Session projection timeout'));
          }, 5_000);
        }),
      ]);
      return {
        sessionId: state.id,
        ...committed.position,
        serverTime: state.serverTime,
        reviewDurationSeconds: committed.snapshot.session.reviewDurationSeconds,
        scoreboard: sessionScoreboard(committed.snapshot),
        remainingMs:
          state.phase === 'ANSWERING' && state.currentQuestion
            ? Math.max(
                0,
                Date.parse(state.currentQuestion.closesAt) -
                  Date.parse(state.serverTime),
              )
            : 0,
        state,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
