import { GameResult } from './game-result.entity';
import type { SessionAggregate } from './session-aggregate';
import type { SessionQuestion } from './session-question.entity';
import {
  acceptedQuestionAnswers as acceptedAnswers,
  sessionPlayers as players,
  scoreClosedQuestion,
  closedQuestionScores,
} from './session-scoring';
import type { ProcessSessionDeadlineCommand } from './session.contracts';
import { SessionError } from './session.error';

function requireHost(aggregate: SessionAggregate, actorId: string): void {
  if (aggregate.session.hostId !== actorId)
    throw new SessionError('HOST_REQUIRED');
}

function requireNotFinished(aggregate: SessionAggregate): void {
  if (aggregate.session.status === 'FINISHED')
    throw new SessionError('SESSION_FINISHED');
}

function currentQuestion(aggregate: SessionAggregate): SessionQuestion {
  const question = aggregate.questions.find(
    (q) => q.position === aggregate.session.currentIndex,
  );
  if (!question) throw new SessionError('INVALID_SESSION_STATE');
  return question;
}

function open(question: SessionQuestion, now: Date, seconds: number): void {
  if (question.status !== 'PENDING')
    throw new SessionError('INVALID_SESSION_STATE');
  question.status = 'OPEN';
  question.openedAt = new Date(now);
  question.closesAt = new Date(now.getTime() + seconds * 1_000);
  question.closedAt = null;
  question.reviewEndsAt = null;
}

function close(
  aggregate: SessionAggregate,
  question: SessionQuestion,
  effectiveTime: Date,
  now: Date,
): void {
  question.status = 'CLOSED';
  question.closedAt = new Date(effectiveTime);
  question.reviewEndsAt = new Date(
    effectiveTime.getTime() + aggregate.session.reviewDurationSeconds * 1000,
  );
  scoreClosedQuestion(aggregate, question, now);
}

export function startSession(
  aggregate: SessionAggregate,
  actorId: string,
  now: Date,
): void {
  requireHost(aggregate, actorId);
  requireNotFinished(aggregate);
  if (aggregate.session.status !== 'WAITING')
    throw new SessionError('SESSION_ALREADY_STARTED');
  const first = aggregate.questions.find((q) => q.position === 0);
  if (!first) throw new SessionError('SESSION_HAS_NO_QUESTIONS');
  if (players(aggregate).length === 0)
    throw new SessionError('SESSION_HAS_NO_PARTICIPANTS');
  open(first, now, aggregate.session.questionDurationSeconds);
  aggregate.session.status = 'IN_PROGRESS';
  aggregate.session.startedAt = new Date(now);
  aggregate.session.currentIndex = 0;
}

function finish(aggregate: SessionAggregate, now: Date): void {
  for (const question of aggregate.questions) {
    if (question.status === 'OPEN') {
      close(
        aggregate,
        question,
        new Date(Math.min(now.getTime(), question.closesAt!.getTime())),
        now,
      );
    }
  }
  aggregate.results = closedQuestionScores(aggregate).map((row) => {
    return Object.assign(new GameResult(), {
      sessionId: aggregate.session.id,
      ...row,
    });
  });
  aggregate.session.status = 'FINISHED';
  aggregate.session.finishedAt = new Date(now);
}

export function finishSession(
  aggregate: SessionAggregate,
  actorId: string,
  now: Date,
): void {
  requireHost(aggregate, actorId);
  requireNotFinished(aggregate);
  finish(aggregate, now);
}

export function advanceSession(
  aggregate: SessionAggregate,
  expectedQuestionId: string,
  now: Date,
  actorId?: string,
): void {
  if (actorId !== undefined) requireHost(aggregate, actorId);
  requireNotFinished(aggregate);
  if (aggregate.session.status !== 'IN_PROGRESS')
    throw new SessionError('INVALID_SESSION_STATE');
  const question = currentQuestion(aggregate);
  if (question.id !== expectedQuestionId)
    throw new SessionError('STALE_QUESTION');
  if (question.status !== 'CLOSED')
    throw new SessionError('QUESTION_NOT_CLOSED');
  if (!question.reviewEndsAt || now < question.reviewEndsAt)
    throw new SessionError('REVIEW_IN_PROGRESS');
  const next = aggregate.questions.find(
    (q) => q.position === question.position + 1,
  );
  if (!next) {
    finish(aggregate, now);
    return;
  }
  open(next, now, aggregate.session.questionDurationSeconds);
  aggregate.session.currentIndex = next.position;
}

function closeIfReady(
  aggregate: SessionAggregate,
  question: SessionQuestion,
  now: Date,
): boolean {
  if (question.status !== 'OPEN') return false;
  const accepted = acceptedAnswers(aggregate, question, now);
  const answered = new Set(accepted.map((answer) => answer.participantId));
  if (
    players(aggregate).length > 0 &&
    answered.size === players(aggregate).length
  ) {
    close(
      aggregate,
      question,
      new Date(
        Math.max(...accepted.map((answer) => answer.answeredAt.getTime())),
      ),
      now,
    );
    return true;
  }
  if (question.closesAt && now >= question.closesAt) {
    close(aggregate, question, question.closesAt, now);
    return true;
  }
  return false;
}

export function evaluateAcceptedAnswers(
  aggregate: SessionAggregate,
  expectedQuestionId: string,
  now: Date,
): boolean {
  if (aggregate.session.status !== 'IN_PROGRESS') return false;
  const question = currentQuestion(aggregate);
  if (question.id !== expectedQuestionId) return false;
  const changed = closeIfReady(aggregate, question, now);
  if (changed && question.reviewEndsAt && now >= question.reviewEndsAt) {
    advanceSession(aggregate, question.id, now);
  }
  return changed;
}

export function processSessionDeadline(
  aggregate: SessionAggregate,
  command: ProcessSessionDeadlineCommand,
  now: Date,
): boolean {
  if (aggregate.session.status !== 'IN_PROGRESS') return false;
  const question = currentQuestion(aggregate);
  if (question.id !== command.expectedQuestionId) return false;
  const deadline =
    command.kind === 'ANSWER' ? question.closesAt : question.reviewEndsAt;
  const expectedStatus = command.kind === 'ANSWER' ? 'OPEN' : 'CLOSED';
  if (
    question.status !== expectedStatus ||
    !deadline ||
    deadline.getTime() !== command.expectedDeadline.getTime() ||
    now < deadline
  )
    return false;
  if (command.kind === 'ANSWER') closeIfReady(aggregate, question, now);
  if (
    question.status === 'CLOSED' &&
    question.reviewEndsAt &&
    now >= question.reviewEndsAt
  ) {
    advanceSession(aggregate, question.id, now);
  }
  return true;
}
