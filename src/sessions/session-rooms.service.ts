import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service';
import { Profile } from '../profiles/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { Question } from '../quizzes/question.entity';
import { Quiz } from '../quizzes/quiz.entity';
import { ActiveSessionMembership } from './active-session-membership.entity';
import { GameSession } from './game-session.entity';
import {
  SessionCodeGenerator,
  SESSION_CODE_ATTEMPTS,
  isUniqueConstraintError,
} from './session-code.generator';
import { SessionParticipant } from './session-participant.entity';
import { SessionQuestion } from './session-question.entity';
import { SessionStateProjector } from './session-state.projector';
import type {
  CreateSessionInput,
  JoinSessionResult,
  SessionState,
} from './session.contracts';
import {
  DEFAULT_QUESTION_DURATION_SECONDS,
  DEFAULT_REVIEW_DURATION_SECONDS,
  MIN_QUESTION_DURATION_SECONDS,
  MAX_QUESTION_DURATION_SECONDS,
  MIN_REVIEW_DURATION_SECONDS,
  MAX_REVIEW_DURATION_SECONDS,
} from './session.contracts';
import { SessionError } from './session.error';
import { SessionsRepository } from './sessions.repository';
import { SessionCoordinator } from './session-coordinator';
import type { RoomEnvelope } from './realtime/session-realtime.contracts';
import type { SessionAggregate } from './session-aggregate';
import {
  SessionNotifications,
  type CommittedSession,
} from './session-notifications';

@Injectable()
export class SessionRoomsService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly profiles: ProfilesService,
    private readonly codes: SessionCodeGenerator,
    private readonly projector: SessionStateProjector,
    private readonly coordinator: SessionCoordinator,
    private readonly notifications: SessionNotifications,
  ) {}

  async create(
    user: AuthenticatedUser,
    input: CreateSessionInput,
  ): Promise<SessionState> {
    const questionDurationSeconds =
      input.questionDurationSeconds === undefined
        ? DEFAULT_QUESTION_DURATION_SECONDS
        : input.questionDurationSeconds;
    const reviewDurationSeconds =
      input.reviewDurationSeconds === undefined
        ? DEFAULT_REVIEW_DURATION_SECONDS
        : input.reviewDurationSeconds;
    if (
      !Number.isInteger(questionDurationSeconds) ||
      questionDurationSeconds < MIN_QUESTION_DURATION_SECONDS ||
      questionDurationSeconds > MAX_QUESTION_DURATION_SECONDS ||
      !Number.isInteger(reviewDurationSeconds) ||
      reviewDurationSeconds < MIN_REVIEW_DURATION_SECONDS ||
      reviewDurationSeconds > MAX_REVIEW_DURATION_SECONDS
    ) {
      throw new SessionError('VALIDATION_ERROR');
    }
    for (let attempt = 0; attempt < SESSION_CODE_ATTEMPTS; attempt += 1) {
      try {
        const snapshot = await this.repository.createTransaction(
          async (manager) => {
            const quiz = await manager.findOneBy(Quiz, {
              id: input.quizId,
              ownerId: user.id,
            });
            if (!quiz) throw new SessionError('QUIZ_NOT_FOUND');
            const originals = await manager.find(Question, {
              where: { quizId: quiz.id },
              order: { position: 'ASC' },
            });
            const session = await manager.save(
              GameSession,
              manager.create(GameSession, {
                hostId: user.id,
                quizId: quiz.id,
                quizTitle: quiz.title,
                code: this.codes.generate(),
                questionDurationSeconds,
                reviewDurationSeconds,
                status: 'WAITING',
                currentIndex: -1,
              }),
            );
            await manager.save(
              SessionQuestion,
              originals.map((question, position) =>
                manager.create(SessionQuestion, {
                  sessionId: session.id,
                  originalQuestionId: question.id,
                  position,
                  statement: question.statement,
                  correctBoolean: question.correctBoolean,
                  imageKey: question.imageKey,
                  status: 'PENDING',
                }),
              ),
            );
            return this.repository.snapshot(manager, session);
          },
        );
        return this.projector.project(snapshot);
      } catch (error) {
        if (!isUniqueConstraintError(error, 'IDX_977fe726299fc1600fed5bf9e3'))
          throw error;
      }
    }
    throw new SessionError('ROOM_CODE_UNAVAILABLE');
  }

  async state(
    user: AuthenticatedUser,
    sessionId: string,
  ): Promise<SessionState> {
    const snapshot = await this.repository.read(sessionId);
    this.requireAccess(user, snapshot);
    return this.projector.project(snapshot);
  }

  private requireAccess(
    user: AuthenticatedUser,
    snapshot: SessionAggregate,
  ): void {
    if (
      snapshot.session.hostId !== user.id &&
      !snapshot.participants.some((p) => p.userId === user.id)
    ) {
      throw new SessionError('SESSION_NOT_FOUND');
    }
  }

  async stateByCode(
    user: AuthenticatedUser,
    code: string,
  ): Promise<RoomEnvelope> {
    const id = await this.repository.resolveId({
      code: code.trim().toUpperCase(),
    });
    let envelope!: RoomEnvelope;
    await this.observe(user, id, async (committed) => {
      envelope = await this.notifications.envelope(committed);
    });
    return envelope;
  }

  async observe(
    user: AuthenticatedUser,
    sessionId: string,
    consume: (committed: CommittedSession) => Promise<void>,
  ): Promise<void> {
    await this.coordinator.run(sessionId, async () => {
      const snapshot = await this.repository.read(sessionId);
      this.requireAccess(user, snapshot);
      await consume(this.notifications.current(snapshot));
    });
  }

  async join(
    user: AuthenticatedUser,
    code: string,
    observe?: (
      participant: SessionParticipant,
      committed: CommittedSession,
      created: boolean,
    ) => Promise<void>,
  ): Promise<JoinSessionResult> {
    let observedState: SessionState | undefined;
    try {
      const joined = await this.repository.locked(
        { code: code.trim().toUpperCase() },
        async (manager, session) => {
          if (session.hostId === user.id)
            throw new SessionError('HOST_CANNOT_PARTICIPATE');
          let participant = await manager.findOneBy(SessionParticipant, {
            sessionId: session.id,
            userId: user.id,
          });
          const created = !participant;
          if (!participant) {
            if (session.status === 'FINISHED')
              throw new SessionError('SESSION_FINISHED');
            if (session.status !== 'WAITING')
              throw new SessionError('SESSION_NOT_JOINABLE');
            const profile = await this.profiles.getOrCreate(user, manager);
            await manager.findOneOrFail(Profile, {
              where: { userId: user.id },
              lock: { mode: 'pessimistic_write' },
            });
            const reservation = await manager.findOneBy(
              ActiveSessionMembership,
              { userId: user.id },
            );
            if (reservation)
              throw new SessionError('ALREADY_IN_ACTIVE_SESSION');
            participant = await manager.save(
              SessionParticipant,
              manager.create(SessionParticipant, {
                sessionId: session.id,
                userId: user.id,
                displayName: profile.displayName,
              }),
            );
            await manager.insert(ActiveSessionMembership, {
              sessionId: session.id,
              userId: user.id,
            });
          }
          return {
            participant,
            created,
            snapshot: await this.repository.snapshot(manager, session),
          };
        },
        observe
          ? async (value, committed) => {
              await observe(value.participant, committed, value.created);
              observedState = (await this.notifications.envelope(committed))
                .state;
            }
          : undefined,
      );
      return {
        participant: this.projector.participant(joined.participant),
        session:
          observedState ?? (await this.projector.project(joined.snapshot)),
      };
    } catch (error) {
      if (isUniqueConstraintError(error, 'PK_active_session_memberships')) {
        throw new SessionError('ALREADY_IN_ACTIVE_SESSION');
      }
      throw error;
    }
  }

  async leave(user: AuthenticatedUser, sessionId: string): Promise<void> {
    await this.repository.locked(
      { id: sessionId },
      async (manager, session) => {
        if (session.hostId === user.id)
          throw new SessionError('HOST_CANNOT_PARTICIPATE');
        if (session.status !== 'WAITING')
          throw new SessionError('SESSION_NOT_LEAVABLE');
        const participant = await manager.findOneBy(SessionParticipant, {
          sessionId,
          userId: user.id,
        });
        if (!participant) return;
        await manager.findOneOrFail(Profile, {
          where: { userId: user.id },
          lock: { mode: 'pessimistic_write' },
        });
        await manager.delete(SessionParticipant, { id: participant.id });
      },
    );
  }
}
