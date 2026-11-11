import type { GameSession } from './game-session.entity';
import type { SessionQuestion } from './session-question.entity';
import type { SessionParticipant } from './session-participant.entity';
import type { Answer } from './answer.entity';
import type { SessionAggregate } from './session-aggregate';

export interface SessionAnswerContext {
  session: GameSession;
  question: SessionQuestion;
  participant: SessionParticipant | null;
  existing: Answer | null;
}

export interface AnswerTransaction<T> {
  value: T;
  before?: SessionAggregate;
  after?: SessionAggregate;
}

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** JSON from PostgreSQL has ISO strings, unlike hydrated TypeORM date columns. */
export function hydrateAnswerContext(
  context: SessionAnswerContext,
): SessionAnswerContext {
  for (const field of [
    'openedAt',
    'closesAt',
    'closedAt',
    'reviewEndsAt',
    'scoredAt',
  ] as const)
    context.question[field] = date(context.question[field]);
  context.session.createdAt = new Date(context.session.createdAt);
  context.session.startedAt = date(context.session.startedAt);
  context.session.finishedAt = date(context.session.finishedAt);
  if (context.participant)
    context.participant.joinedAt = new Date(context.participant.joinedAt);
  if (context.existing)
    context.existing.answeredAt = new Date(context.existing.answeredAt);
  return context;
}
