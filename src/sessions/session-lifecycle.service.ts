import { Injectable, Optional } from '@nestjs/common';
import { GameTelemetry } from './game-telemetry';
import type { SessionAggregate } from './session-aggregate';
import { SessionClock } from './session.clock';
import type {
  AdvanceSessionCommand,
  EvaluateAcceptedAnswersCommand,
  FinishSessionCommand,
  ProcessSessionDeadlineCommand,
  StartSessionCommand,
} from './session.contracts';
import {
  advanceSession,
  evaluateAcceptedAnswers,
  finishSession,
  processSessionDeadline,
  startSession,
} from './session.rules';
import { SessionsRepository } from './sessions.repository';
import type { CommittedSession } from './session-notifications';

@Injectable()
export class SessionLifecycleService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly clock: SessionClock,
    @Optional() private readonly telemetry?: GameTelemetry,
  ) {}

  private async mutate(
    sessionId: string,
    work: (snapshot: SessionAggregate) => boolean | void,
  ): Promise<CommittedSession> {
    let committed!: CommittedSession;
    await this.repository.locked(
      { id: sessionId },
      async (manager, session) => {
        const snapshot = await this.repository.snapshot(manager, session);
        if (work(snapshot) !== false)
          await this.repository.persist(manager, snapshot);
      },
      (_value, result) => {
        committed = result;
        return Promise.resolve();
      },
    );
    return committed;
  }

  start(command: StartSessionCommand): Promise<CommittedSession> {
    return this.mutate(command.sessionId, (snapshot) =>
      startSession(snapshot, command.actorId, this.clock.now()),
    );
  }

  advance(command: AdvanceSessionCommand): Promise<CommittedSession> {
    return this.mutate(command.sessionId, (snapshot) =>
      advanceSession(
        snapshot,
        command.expectedQuestionId,
        this.clock.now(),
        command.actorId,
      ),
    );
  }

  finish(command: FinishSessionCommand): Promise<CommittedSession> {
    return this.mutate(command.sessionId, (snapshot) =>
      finishSession(snapshot, command.actorId, this.clock.now()),
    );
  }

  evaluateAcceptedAnswers(
    command: EvaluateAcceptedAnswersCommand,
  ): Promise<CommittedSession> {
    return this.mutate(command.sessionId, (snapshot) =>
      evaluateAcceptedAnswers(
        snapshot,
        command.expectedQuestionId,
        this.clock.now(),
      ),
    );
  }

  async processDeadline(
    command: ProcessSessionDeadlineCommand,
  ): Promise<CommittedSession> {
    let lag: number | undefined;
    const committed = await this.mutate(command.sessionId, (snapshot) => {
      const now = this.clock.now();
      const changed = processSessionDeadline(snapshot, command, now);
      if (changed) lag = now.getTime() - command.expectedDeadline.getTime();
      return changed;
    });
    if (lag !== undefined) this.telemetry?.deadlineLag(command.kind, lag);
    return committed;
  }
}
