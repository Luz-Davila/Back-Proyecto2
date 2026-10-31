import { randomUUID } from 'crypto';
import { createSessionFixture } from '../../test/support/session-fixtures';
import { Answer } from './answer.entity';
import { SessionParticipant } from './session-participant.entity';
import type { SessionAggregate } from './session-aggregate';
import {
  startSession,
  finishSession,
  evaluateAcceptedAnswers,
  processSessionDeadline,
  advanceSession,
} from './session.rules';
import { scoreClosedQuestion, sessionScoreboard } from './session-scoring';

function fixture(choices: Array<[boolean, number]>, review = 5) {
  const f = createSessionFixture(30);
  f.session.reviewDurationSeconds = review;
  const participants = choices.map(() =>
    Object.assign(new SessionParticipant(), f.participant, {
      id: randomUUID(),
      userId: randomUUID(),
    }),
  );
  const aggregate: SessionAggregate = {
    session: f.session,
    questions: f.questions,
    participants,
    answers: [],
    results: [],
  };
  startSession(aggregate, f.host.id, f.clock.now());
  aggregate.answers = choices.map(([choice, ms], i) =>
    Object.assign(new Answer(), {
      id: randomUUID(),
      sessionQuestionId: f.questions[0].id,
      participantId: participants[i].id,
      choice,
      answeredAt: new Date(f.clock.now().getTime() + ms),
      score: 0,
    }),
  );
  f.clock.advance(Math.max(0, ...choices.map(([, ms]) => ms)));
  return { ...f, aggregate };
}

describe('Adjudicación 0/1/3 al cierre', () => {
  it.each([
    { choices: [[true, 0]], scores: [3] },
    { choices: [[true, 2999]], scores: [3] },
    { choices: [[true, 3000]], scores: [1] },
    {
      choices: [
        [false, 400],
        [true, 800],
        [true, 1500],
      ],
      scores: [0, 3, 1],
    },
    {
      choices: [
        [true, 1000],
        [true, 1000],
        [true, 1500],
      ],
      scores: [3, 3, 1],
    },
    {
      choices: [
        [false, 0],
        [true, 4000],
      ],
      scores: [0, 1],
    },
    {
      choices: [
        [false, 1000],
        [false, 2000],
      ],
      scores: [0, 0],
    },
  ])(
    'puntúa $choices con $scores sin bonus repetido',
    ({ choices, scores }) => {
      const f = fixture(choices as Array<[boolean, number]>);
      expect(
        sessionScoreboard(f.aggregate).every((row) => row.totalScore === 0),
      ).toBe(true);
      evaluateAcceptedAnswers(f.aggregate, f.questions[0].id, f.clock.now());
      expect(f.aggregate.answers.map((a) => a.score)).toEqual(scores);
      const scoredAt = f.questions[0].scoredAt;
      expect(scoredAt).toEqual(f.clock.now());
      expect(
        scoreClosedQuestion(f.aggregate, f.questions[0], f.clock.now()),
      ).toBe(false);
      expect(f.questions[0].scoredAt).toBe(scoredAt);
      finishSession(f.aggregate, f.host.id, f.clock.now());
      expect(f.aggregate.answers.map((a) => a.score)).toEqual(scores);
      expect(sessionScoreboard(f.aggregate)).toEqual(
        f.aggregate.results.map(({ participantId, totalScore, rank }) => ({
          participantId,
          totalScore,
          rank,
        })),
      );
    },
  );

  it.each([3, 7, 15])(
    'usa revisión de %i segundos y no permite acortarla',
    (review) => {
      const f = fixture([[true, 1000]], review);
      evaluateAcceptedAnswers(f.aggregate, f.questions[0].id, f.clock.now());
      expect(
        f.questions[0].reviewEndsAt!.getTime() -
          f.questions[0].closedAt!.getTime(),
      ).toBe(review * 1000);
      f.clock.advance(review * 1000 - 1);
      expect(() =>
        advanceSession(
          f.aggregate,
          f.questions[0].id,
          f.clock.now(),
          f.host.id,
        ),
      ).toThrow('revisión');
      f.clock.advance(1);
      advanceSession(f.aggregate, f.questions[0].id, f.clock.now(), f.host.id);
      expect(f.session.currentIndex).toBe(1);
      expect(sessionScoreboard(f.aggregate)[0].totalScore).toBe(3);
    },
  );

  it('deadline y finish preservan puntos cerrados; omisiones no crean Answer', () => {
    const f = fixture([
      [true, 800],
      [false, 500],
    ]);
    f.aggregate.answers.pop();
    f.clock.advance(30_000);
    const job = {
      sessionId: f.session.id,
      expectedQuestionId: f.questions[0].id,
      kind: 'ANSWER' as const,
      expectedDeadline: f.questions[0].closesAt!,
    };
    processSessionDeadline(f.aggregate, job, f.clock.now());
    expect(f.aggregate.answers).toHaveLength(1);
    expect(f.aggregate.answers[0].score).toBe(3);
    expect(processSessionDeadline(f.aggregate, job, f.clock.now())).toBe(false);
    finishSession(f.aggregate, f.host.id, f.clock.now());
    expect(f.aggregate.results.map((r) => [r.totalScore, r.rank])).toEqual([
      [3, 1],
      [0, 2],
    ]);
    expect(f.questions[1].scoredAt).toBeNull();
  });

  it('el scoreboard histórico usa resultados persistidos sin convertir puntos', () => {
    const f = fixture([[true, 1000]]);
    finishSession(f.aggregate, f.host.id, f.clock.now());
    f.aggregate.results[0].totalScore = 100;
    expect(sessionScoreboard(f.aggregate)[0].totalScore).toBe(100);
  });
});
