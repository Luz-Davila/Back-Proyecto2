import type { Answer } from '../../src/sessions/answer.entity';
import type { AnswerReceipt } from '../../src/sessions/session.contracts';
import type { SessionQuestion } from '../../src/sessions/session-question.entity';

/** Missing ACKs are a delivery failure, not evidence of corrupt persisted data. */
export function verifyAnswerRow(
  answer: Pick<
    Answer,
    'id' | 'sessionQuestionId' | 'choice' | 'choiceIndex' | 'answeredAt'
  >,
  question: Pick<SessionQuestion, 'openedAt' | 'closesAt'>,
  selected: boolean | number,
  sentAt: number,
  checkedAt: number,
  receipt?: AnswerReceipt,
) {
  return {
    choices:
      typeof selected === 'boolean'
        ? answer.choice === selected && answer.choiceIndex == null
        : answer.choiceIndex === selected && answer.choice == null,
    dates:
      answer.answeredAt >= question.openedAt! &&
      answer.answeredAt < question.closesAt! &&
      answer.answeredAt.getTime() >= sentAt &&
      answer.answeredAt.getTime() <= checkedAt,
    receiptMatches:
      receipt == null
        ? null
        : receipt.id === answer.id &&
          receipt.sessionQuestionId === answer.sessionQuestionId &&
          receipt.answeredAt === answer.answeredAt.toISOString() &&
          (typeof selected === 'boolean'
            ? receipt.choice === selected
            : receipt.choiceIndex === selected),
  };
}

/** Observe only committed, scored questions; an open next round is not history. */
export class ClosedScoreVerifier {
  private readonly scores = new Map<string, number>();
  observe(
    questions: Pick<SessionQuestion, 'id' | 'scoredAt'>[],
    answers: Pick<Answer, 'id' | 'sessionQuestionId' | 'score'>[],
  ): boolean {
    const scored = new Set(
      questions.filter((q) => q.scoredAt).map((q) => q.id),
    );
    let stable = true;
    for (const answer of answers) {
      if (!scored.has(answer.sessionQuestionId)) continue;
      if (this.scores.has(answer.id))
        stable &&= this.scores.get(answer.id) === answer.score;
      this.scores.set(answer.id, answer.score);
    }
    return stable;
  }
}
