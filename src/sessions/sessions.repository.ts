import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ActiveSessionMembership } from './active-session-membership.entity';
import { Answer } from './answer.entity';
import { GameResult } from './game-result.entity';
import { GameSession } from './game-session.entity';
import type { SessionAggregate } from './session-aggregate';
import { SessionParticipant } from './session-participant.entity';
import { SessionQuestion } from './session-question.entity';
import type { ProcessSessionDeadlineCommand } from './session.contracts';
import { SessionError } from './session.error';
import { SessionCoordinator } from './session-coordinator';
import {
  SessionNotifications,
  type SessionCommitObserver,
} from './session-notifications';

@Injectable()
export class SessionsRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly coordinator: SessionCoordinator,
    private readonly notifications: SessionNotifications,
  ) {}

  createTransaction<T>(
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', work);
  }

  locked<T>(
    where: { id: string } | { code: string },
    work: (manager: EntityManager, session: GameSession) => Promise<T>,
    observe?: SessionCommitObserver<T>,
  ): Promise<T> {
    return this.resolveId(where).then((id) =>
      this.coordinator.run(id, async () => {
        const result = await this.dataSource.transaction(async (manager) => {
          const session = await manager.findOne(GameSession, {
            where,
            lock: { mode: 'pessimistic_write' },
          });
          if (!session) throw new SessionError('SESSION_NOT_FOUND');
          const before = structuredClone(await this.snapshot(manager, session));
          const value = await work(manager, session);
          const after = await this.snapshot(manager, session);
          return { value, before, after };
        });
        const committed = await this.notifications.committed(
          result.before,
          result.after,
        );
        await observe?.(result.value, committed);
        return result.value;
      }),
    );
  }

  async resolveId(where: { id: string } | { code: string }): Promise<string> {
    if ('id' in where) return where.id;
    const session = await this.dataSource
      .getRepository(GameSession)
      .findOne({ where, select: { id: true } });
    if (!session) throw new SessionError('SESSION_NOT_FOUND');
    return session.id;
  }

  async sessionForQuestion(questionId: string): Promise<string> {
    const question = await this.dataSource
      .getRepository(SessionQuestion)
      .findOne({
        where: { id: questionId },
        select: { sessionId: true },
      });
    if (!question) throw new SessionError('SESSION_NOT_FOUND');
    return question.sessionId;
  }

  read(sessionId: string): Promise<SessionAggregate> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const session = await manager.findOneBy(GameSession, { id: sessionId });
      if (!session) throw new SessionError('SESSION_NOT_FOUND');
      return this.snapshot(manager, session);
    });
  }

  async snapshot(
    manager: EntityManager,
    session: GameSession,
  ): Promise<SessionAggregate> {
    const questions = await manager.find(SessionQuestion, {
      where: { sessionId: session.id },
      order: { position: 'ASC' },
    });
    const participants = await manager.find(SessionParticipant, {
      where: { sessionId: session.id },
      order: { joinedAt: 'ASC', id: 'ASC' },
    });
    const answers = await manager
      .createQueryBuilder(Answer, 'answer')
      .innerJoin(
        'answer.sessionQuestion',
        'question',
        'question.sessionId = :sessionId',
      )
      .innerJoin(
        'answer.participant',
        'participant',
        'participant.sessionId = :sessionId',
      )
      .setParameter('sessionId', session.id)
      .getMany();
    const results = await manager.find(GameResult, {
      where: { sessionId: session.id },
      order: { rank: 'ASC', participantId: 'ASC' },
    });
    return { session, questions, participants, answers, results };
  }

  async persist(
    manager: EntityManager,
    aggregate: SessionAggregate,
  ): Promise<void> {
    await manager.save(GameSession, aggregate.session);
    await manager.save(SessionQuestion, aggregate.questions);
    const scored = new Set(
      aggregate.questions
        .filter((q) => q.status === 'CLOSED' && q.scoredAt)
        .map((q) => q.id),
    );
    for (const answer of aggregate.answers) {
      if (scored.has(answer.sessionQuestionId)) {
        await manager.update(
          Answer,
          { id: answer.id },
          { score: answer.score },
        );
      }
    }
    if (aggregate.session.status === 'FINISHED') {
      await manager.save(GameResult, aggregate.results);
      await manager.delete(ActiveSessionMembership, {
        sessionId: aggregate.session.id,
      });
    }
  }

  async dueDeadlines(now: Date): Promise<ProcessSessionDeadlineCommand[]> {
    const rows = await this.dataSource.query<
      Array<{
        sessionId: string;
        expectedQuestionId: string;
        status: 'OPEN' | 'CLOSED';
        closesAt: Date;
        reviewEndsAt: Date | null;
      }>
    >(
      `SELECT s.id AS "sessionId", q.id AS "expectedQuestionId", q.status,
              q."closesAt", q."reviewEndsAt"
       FROM game_sessions s JOIN session_questions q
         ON q."sessionId" = s.id AND q.position = s."currentIndex"
       WHERE s.status = 'IN_PROGRESS' AND
         ((q.status = 'OPEN' AND q."closesAt" <= $1) OR
          (q.status = 'CLOSED' AND q."reviewEndsAt" <= $1))
       ORDER BY s.id LIMIT 100`,
      [now],
    );
    return rows.map((row) => ({
      sessionId: row.sessionId,
      expectedQuestionId: row.expectedQuestionId,
      kind: row.status === 'OPEN' ? 'ANSWER' : 'REVIEW',
      expectedDeadline:
        row.status === 'OPEN' ? row.closesAt : row.reviewEndsAt!,
    }));
  }
}
