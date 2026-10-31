import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import type { SessionAggregate } from './session-aggregate';
import type { SessionParticipant } from './session-participant.entity';
import { SessionClock } from './session.clock';
import type {
  CurrentQuestionView,
  ParticipantView,
  SessionState,
} from './session.contracts';

@Injectable()
export class SessionStateProjector {
  constructor(
    private readonly storage: StorageService,
    private readonly clock: SessionClock,
  ) {}

  participant(participant: SessionParticipant): ParticipantView {
    return {
      id: participant.id,
      sessionId: participant.sessionId,
      userId: participant.userId,
      displayName: participant.displayName,
      joinedAt: participant.joinedAt.toISOString(),
    };
  }

  async project(
    aggregate: SessionAggregate,
    signal?: AbortSignal,
  ): Promise<SessionState> {
    const { session, participants, questions, results } = aggregate;
    const current =
      session.status === 'IN_PROGRESS'
        ? questions.find(
            (question) => question.position === session.currentIndex,
          )
        : undefined;
    let currentQuestion: CurrentQuestionView | null = null;
    if (current && (current.status === 'OPEN' || current.status === 'CLOSED')) {
      const fields = {
        id: current.id,
        position: current.position,
        statement: current.statement,
        imageUrl: current.imageKey
          ? await this.storage.signedUrl(current.imageKey, 600, signal)
          : null,
        openedAt: current.openedAt!.toISOString(),
        closesAt: current.closesAt!.toISOString(),
        closedAt: current.closedAt?.toISOString() ?? null,
        reviewEndsAt: current.reviewEndsAt?.toISOString() ?? null,
      };
      currentQuestion =
        current.status === 'CLOSED'
          ? {
              ...fields,
              status: 'CLOSED',
              correctBoolean: current.correctBoolean,
            }
          : { ...fields, status: 'OPEN' };
    }
    return {
      id: session.id,
      code: session.code,
      hostId: session.hostId,
      quizTitle: session.quizTitle,
      status: session.status,
      phase:
        session.status === 'WAITING'
          ? 'WAITING'
          : session.status === 'FINISHED'
            ? 'FINISHED'
            : current?.status === 'CLOSED'
              ? 'REVIEW'
              : 'ANSWERING',
      questionDurationSeconds: session.questionDurationSeconds,
      currentIndex: session.currentIndex,
      questionsCount: questions.length,
      startedAt: session.startedAt?.toISOString() ?? null,
      finishedAt: session.finishedAt?.toISOString() ?? null,
      serverTime: this.clock.now().toISOString(),
      participants: [...participants]
        .sort(
          (a, b) =>
            a.joinedAt.getTime() - b.joinedAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((participant) => this.participant(participant)),
      currentQuestion,
      results:
        session.status === 'FINISHED'
          ? [...results]
              .sort(
                (a, b) =>
                  a.rank - b.rank ||
                  a.participantId.localeCompare(b.participantId),
              )
              .map(({ participantId, totalScore, rank }) => ({
                participantId,
                totalScore,
                rank,
              }))
          : null,
    };
  }
}
