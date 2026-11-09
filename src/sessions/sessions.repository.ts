import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { isCorrectAnswer } from '../quizzes/question-kind';
import { ActiveSessionMembership } from './active-session-membership.entity';
import { Answer } from './answer.entity';
import { GameResult } from './game-result.entity';
import { GameSession } from './game-session.entity';
import type { SessionAggregate } from './session-aggregate';
import { SessionParticipant } from './session-participant.entity';
import { SessionQuestion } from './session-question.entity';
import type {
  PlayedQuestion,
  PlayedSessionItem,
  ProcessSessionDeadlineCommand,
  SessionHistoryItem,
  SessionHistoryQuestionStat,
  SessionHistoryRankingRow,
} from './session.contracts';
import { SESSION_HISTORY_LIMIT } from './session.contracts';
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

  async historyForHost(hostId: string): Promise<SessionHistoryItem[]> {
    const sessions = await this.dataSource.getRepository(GameSession).find({
      where: { hostId, status: 'FINISHED' },
      order: { finishedAt: 'DESC', createdAt: 'DESC' },
      take: SESSION_HISTORY_LIMIT,
    });
    if (sessions.length === 0) return [];
    const ids = sessions.map((session) => session.id);
    const [participants, results, questions] = await Promise.all([
      this.dataSource.getRepository(SessionParticipant).find({
        where: { sessionId: In(ids) },
      }),
      this.dataSource.getRepository(GameResult).find({
        where: { sessionId: In(ids) },
        order: { rank: 'ASC', participantId: 'ASC' },
      }),
      this.dataSource.getRepository(SessionQuestion).find({
        where: { sessionId: In(ids) },
      }),
    ]);
    const answers =
      questions.length === 0
        ? []
        : await this.dataSource
            .createQueryBuilder(Answer, 'answer')
            .where('answer.sessionQuestionId IN (:...questionIds)', {
              questionIds: questions.map((question) => question.id),
            })
            .getMany();
    return sessions.map((session) =>
      toHistoryItem(session, participants, results, questions, answers),
    );
  }

  async playedForUser(userId: string): Promise<PlayedSessionItem[]> {
    const mine = await this.dataSource.getRepository(SessionParticipant).find({
      where: { userId },
    });
    if (mine.length === 0) return [];
    const sessionIds = [...new Set(mine.map((row) => row.sessionId))];
    const sessions = await this.dataSource.getRepository(GameSession).find({
      where: { id: In(sessionIds), status: 'FINISHED' },
      order: { finishedAt: 'DESC', createdAt: 'DESC' },
      take: SESSION_HISTORY_LIMIT,
    });
    if (sessions.length === 0) return [];
    const ids = sessions.map((session) => session.id);
    const [participants, results, questions] = await Promise.all([
      this.dataSource.getRepository(SessionParticipant).find({
        where: { sessionId: In(ids) },
      }),
      this.dataSource.getRepository(GameResult).find({
        where: { sessionId: In(ids) },
      }),
      this.dataSource.getRepository(SessionQuestion).find({
        where: { sessionId: In(ids) },
      }),
    ]);
    const answers =
      questions.length === 0
        ? []
        : await this.dataSource
            .createQueryBuilder(Answer, 'answer')
            .where('answer.sessionQuestionId IN (:...questionIds)', {
              questionIds: questions.map((question) => question.id),
            })
            .getMany();
    return sessions.map((session) =>
      toPlayedItem(userId, session, participants, results, questions, answers),
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
      expectedDeadline: new Date(
        row.status === 'OPEN' ? row.closesAt : row.reviewEndsAt!,
      ),
    }));
  }
}

function toHistoryItem(
  session: GameSession,
  participants: SessionParticipant[],
  results: GameResult[],
  questions: SessionQuestion[],
  answers: Answer[],
): SessionHistoryItem {
  const sessionParticipants = participants.filter(
    (participant) => participant.sessionId === session.id,
  );
  const names = new Map(
    sessionParticipants.map((participant) => [
      participant.id,
      participant.displayName,
    ]),
  );
  const sessionQuestions = questions
    .filter((question) => question.sessionId === session.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const questionById = new Map(
    sessionQuestions.map((question) => [question.id, question]),
  );
  const sessionAnswers = answers.filter((answer) =>
    questionById.has(answer.sessionQuestionId),
  );
  const questionStats: SessionHistoryQuestionStat[] = sessionQuestions.map(
    (question) =>
      questionStat(
        question,
        sessionParticipants,
        names,
        sessionAnswers.filter(
          (answer) => answer.sessionQuestionId === question.id,
        ),
      ),
  );
  const correctCount = questionStats.reduce(
    (sum, stat) => sum + stat.correctCount,
    0,
  );
  const wrongCount = questionStats.reduce(
    (sum, stat) => sum + stat.wrongCount,
    0,
  );
  const ranking: SessionHistoryRankingRow[] = results
    .filter((result) => result.sessionId === session.id)
    .map((result) => ({
      participantId: result.participantId,
      displayName: names.get(result.participantId) ?? 'Participante',
      totalScore: result.totalScore,
      rank: result.rank,
    }));
  const winner = ranking.find((row) => row.rank === 1) ?? null;
  return {
    id: session.id,
    code: session.code,
    quizTitle: session.quizTitle,
    finishedAt: (session.finishedAt ?? session.createdAt).toISOString(),
    participantCount: sessionParticipants.length,
    questionsCount: sessionQuestions.length,
    winnerDisplayName: winner?.displayName ?? null,
    winnerScore: winner?.totalScore ?? null,
    correctCount,
    wrongCount,
    unansweredCount: questionStats.reduce(
      (sum, stat) => sum + stat.unansweredCount,
      0,
    ),
    ranking,
    questions: questionStats,
  };
}

function toPlayedItem(
  userId: string,
  session: GameSession,
  participants: SessionParticipant[],
  results: GameResult[],
  questions: SessionQuestion[],
  answers: Answer[],
): PlayedSessionItem {
  const sessionParticipants = participants.filter(
    (participant) => participant.sessionId === session.id,
  );
  const me =
    sessionParticipants.find((participant) => participant.userId === userId) ??
    null;
  const names = new Map(
    sessionParticipants.map((participant) => [
      participant.id,
      participant.displayName,
    ]),
  );
  const sessionQuestions = questions
    .filter((question) => question.sessionId === session.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const mineAnswers = new Map(
    answers
      .filter(
        (answer) => me != null && answer.participantId === me.id,
      )
      .map((answer) => [answer.sessionQuestionId, answer]),
  );
  const playedQuestions: PlayedQuestion[] = sessionQuestions.map((question) => {
    const mine = mineAnswers.get(question.id) ?? null;
    const multiple = (question.kind ?? 'boolean') === 'multiple';
    return {
      position: question.position,
      statement: question.statement,
      kind: question.kind ?? 'boolean',
      options: question.options ?? null,
      correctBoolean: question.correctBoolean,
      correctIndexes: question.correctIndexes ?? null,
      myChoice: mine
        ? multiple
          ? (mine.choiceIndex ?? null)
          : (mine.choice ?? null)
        : null,
    };
  });
  const ranking = results
    .filter((result) => result.sessionId === session.id)
    .sort((a, b) => a.rank - b.rank);
  const myResult =
    me == null
      ? null
      : (ranking.find((result) => result.participantId === me.id) ?? null);
  const winner = ranking.find((row) => row.rank === 1) ?? null;
  const correctCount = playedQuestions.filter((question) =>
    playedChoiceIsCorrect(question),
  ).length;
  const wrongCount = playedQuestions.filter(
    (question) => question.myChoice !== null && !playedChoiceIsCorrect(question),
  ).length;
  return {
    id: session.id,
    code: session.code,
    quizTitle: session.quizTitle,
    finishedAt: (session.finishedAt ?? session.createdAt).toISOString(),
    questionsCount: sessionQuestions.length,
    participantCount: sessionParticipants.length,
    rank: myResult?.rank ?? null,
    totalScore: myResult?.totalScore ?? 0,
    correctCount,
    wrongCount,
    unansweredCount: sessionQuestions.length - correctCount - wrongCount,
    winnerDisplayName: winner
      ? (names.get(winner.participantId) ?? 'Participante')
      : null,
    questions: playedQuestions,
  };
}

function questionStat(
  question: SessionQuestion,
  participants: SessionParticipant[],
  names: Map<string, string>,
  answers: Answer[],
): SessionHistoryQuestionStat {
  const answered = new Set(answers.map((answer) => answer.participantId));
  const correctNames: string[] = [];
  const wrongNames: string[] = [];
  for (const answer of answers) {
    const name = names.get(answer.participantId) ?? 'Participante';
    if (isCorrectAnswer(question, answer)) correctNames.push(name);
    else wrongNames.push(name);
  }
  const unansweredNames = participants
    .filter((participant) => !answered.has(participant.id))
    .map((participant) => participant.displayName);
  correctNames.sort((a, b) => a.localeCompare(b, 'es'));
  wrongNames.sort((a, b) => a.localeCompare(b, 'es'));
  unansweredNames.sort((a, b) => a.localeCompare(b, 'es'));
  return {
    position: question.position,
    statement: question.statement,
    kind: question.kind ?? 'boolean',
    options: question.options ?? null,
    correctBoolean: question.correctBoolean,
    correctIndexes: question.correctIndexes ?? null,
    correctCount: correctNames.length,
    wrongCount: wrongNames.length,
    unansweredCount: unansweredNames.length,
    correctNames,
    wrongNames,
    unansweredNames,
  };
}

function playedChoiceIsCorrect(question: PlayedQuestion): boolean {
  if (question.myChoice === null) return false;
  if (question.kind === 'multiple') {
    return typeof question.myChoice === 'number' && (question.correctIndexes ?? []).includes(question.myChoice);
  }
  return question.myChoice === question.correctBoolean;
}
