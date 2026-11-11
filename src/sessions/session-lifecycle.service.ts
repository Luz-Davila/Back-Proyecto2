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
import { SessionAdmissions } from './session-admissions';

@Injectable()
export class SessionLifecycleService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly clock: SessionClock,
    @Optional() private readonly telemetry?: GameTelemetry,
    private readonly admissions?: SessionAdmissions,
  ) {}

  private async mutate(
    sessionId: string,
    work: (snapshot: SessionAggregate) => boolean | void,
    previousWaitMs = 0,
  ): Promise<CommittedSession> {
    let committed!: CommittedSession;
    await this.repository.locked(
      { id: sessionId },
      async (manager, _session, snapshot) => {
        const before = structuredClone(snapshot);
        if (work(snapshot) !== false)
          await this.repository.persist(manager, snapshot, before);
      },
      (_value, result) => {
        committed = result;
        return Promise.resolve();
      },
      previousWaitMs,
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
    if (this.admissions)
      return this.admissions.run(
        command.expectedQuestionId,
        () => Promise.resolve(command.sessionId),
        (admission) => this.processAdmittedDeadline(command, admission.waitMs),
      );
    return this.processAdmittedDeadline(command);
  }

  private async processAdmittedDeadline(
    command: ProcessSessionDeadlineCommand,
    previousWaitMs = 0,
  ): Promise<CommittedSession> {
    let lag: number | undefined;
    const committed = await this.mutate(
      command.sessionId,
      (snapshot) => {
        const now = this.clock.now();
        const changed = processSessionDeadline(snapshot, command, now);
        if (changed) lag = now.getTime() - command.expectedDeadline.getTime();
        return changed;
      },
      previousWaitMs,
    );
    if (lag !== undefined) this.telemetry?.deadlineLag(command.kind, lag);
    return committed;
  }
}
