import { isCorrectAnswer } from '../quizzes/question-kind';
import type { SessionAggregate } from './session-aggregate';
import type { SessionQuestion } from './session-question.entity';
import {
  SPEED_BONUS_WINDOW_MS,
  type SessionResultView,
} from './session.contracts';

export function sessionPlayers(aggregate: SessionAggregate) {
  return aggregate.participants.filter(
    (p) => p.userId !== aggregate.session.hostId,
  );
}

export function acceptedQuestionAnswers(
  aggregate: SessionAggregate,
  question: SessionQuestion,
  now: Date,
) {
  if (!question.openedAt || !question.closesAt) return [];
  const players = new Set(sessionPlayers(aggregate).map((p) => p.id));
  return aggregate.answers.filter(
    (answer) =>
      answer.sessionQuestionId === question.id &&
      players.has(answer.participantId) &&
      answer.answeredAt >= question.openedAt! &&
      answer.answeredAt < question.closesAt! &&
      answer.answeredAt <= now &&
      (!question.closedAt || answer.answeredAt <= question.closedAt),
  );
}

export function scoreClosedQuestion(
  aggregate: SessionAggregate,
  question: SessionQuestion,
  now: Date,
): boolean {
  if (question.status !== 'CLOSED' || question.scoredAt) return false;
  const answers = acceptedQuestionAnswers(aggregate, question, now);
  const fastCorrect = answers.filter(
    (a) =>
      isCorrectAnswer(question, a) &&
      a.answeredAt.getTime() - question.openedAt!.getTime() <
        SPEED_BONUS_WINDOW_MS,
  );
  const first = fastCorrect.length
    ? Math.min(...fastCorrect.map((a) => a.answeredAt.getTime()))
    : undefined;
  for (const answer of answers) {
    const base =
      !isCorrectAnswer(question, answer)
        ? 0
        : answer.answeredAt.getTime() === first
          ? 3
          : 1;
    answer.score =
      base +
      (base > 0 ? streakBonus(aggregate, question, answer.participantId) : 0);
  }
  question.scoredAt = new Date(now);
  return true;
}

/** Puntos extra por aciertos seguidos: el primero vale lo normal y cada uno más suma +1. */
export function streakBonus(
  aggregate: SessionAggregate,
  question: SessionQuestion,
  participantId: string,
): number {
  const ordered = [...aggregate.questions].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex((item) => item.id === question.id);
  let streak = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = ordered[cursor];
    const answer = aggregate.answers.find(
      (item) =>
        item.sessionQuestionId === previous.id &&
        item.participantId === participantId,
    );
    if (!answer || !isCorrectAnswer(previous, answer)) break;
    streak += 1;
  }
  return streak - 1;
}

export function closedQuestionScores(
  aggregate: SessionAggregate,
): SessionResultView[] {
  const totals = new Map<string, number>();
  for (const question of aggregate.questions) {
    if (
      question.status !== 'CLOSED' ||
      !question.scoredAt ||
      !question.closedAt
    )
      continue;
    for (const answer of acceptedQuestionAnswers(
      aggregate,
      question,
      question.closedAt,
    )) {
      totals.set(
        answer.participantId,
        (totals.get(answer.participantId) ?? 0) + answer.score,
      );
    }
  }
  const rows = sessionPlayers(aggregate)
    .map((p) => ({ participantId: p.id, totalScore: totals.get(p.id) ?? 0 }))
    .sort(
      (a, b) =>
        b.totalScore - a.totalScore ||
        a.participantId.localeCompare(b.participantId),
    );
  let rank = 0;
  let previous: number | undefined;
  return rows.map((row) => {
    if (previous !== row.totalScore) rank += 1;
    previous = row.totalScore;
    return { ...row, rank };
  });
}

export function sessionScoreboard(
  aggregate: SessionAggregate,
): SessionResultView[] {
  if (aggregate.session.status !== 'FINISHED')
    return closedQuestionScores(aggregate);
  return [...aggregate.results]
    .sort(
      (a, b) =>
        a.rank - b.rank || a.participantId.localeCompare(b.participantId),
    )
    .map(({ participantId, totalScore, rank }) => ({
      participantId,
      totalScore,
      rank,
    }));
}
