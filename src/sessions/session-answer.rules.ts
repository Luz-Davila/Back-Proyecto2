import type { SessionAggregate } from './session-aggregate';
import type { AnswerReceipt, SubmitAnswerInput } from './session.contracts';
import type { Answer } from './answer.entity';
import { SessionError } from './session.error';

export function answerReceipt(answer: Answer): AnswerReceipt {
  return {
    id: answer.id,
    sessionQuestionId: answer.sessionQuestionId,
    choice: answer.choice,
    answeredAt: answer.answeredAt.toISOString(),
  };
}

export function authorizeAnswer(
  aggregate: SessionAggregate,
  actorId: string,
  input: SubmitAnswerInput,
) {
  const question = aggregate.questions.find(
    (q) => q.id === input.sessionQuestionId,
  );
  if (!question) throw new SessionError('SESSION_NOT_FOUND');
  if (aggregate.session.hostId === actorId)
    throw new SessionError('HOST_CANNOT_PARTICIPATE');
  const participant = aggregate.participants.find((p) => p.userId === actorId);
  if (!participant) throw new SessionError('SESSION_NOT_FOUND');
  const existing = aggregate.answers.find(
    (a) =>
      a.sessionQuestionId === question.id && a.participantId === participant.id,
  );
  if (existing && existing.choice !== input.choice)
    throw new SessionError('ANSWER_ALREADY_SUBMITTED');
  return { question, participant, existing };
}

export function requireAnswerWindow(
  aggregate: SessionAggregate,
  input: SubmitAnswerInput,
  now: Date,
): void {
  const question = aggregate.questions.find(
    (q) => q.id === input.sessionQuestionId,
  )!;
  if (question.openedAt && question.closesAt && now >= question.closesAt)
    throw new SessionError('ANSWER_TOO_LATE');
  if (aggregate.session.status === 'FINISHED')
    throw new SessionError('SESSION_FINISHED');
  if (
    aggregate.session.status !== 'IN_PROGRESS' ||
    question.position !== aggregate.session.currentIndex ||
    question.status !== 'OPEN' ||
    !question.openedAt ||
    !question.closesAt ||
    now < question.openedAt
  ) {
    throw new SessionError('QUESTION_NOT_OPEN');
  }
}
