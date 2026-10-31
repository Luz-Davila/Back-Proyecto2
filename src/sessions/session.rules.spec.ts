import { randomUUID } from 'crypto';
import { createSessionFixture } from '../../test/support/session-fixtures';
import { Answer } from './answer.entity';
import type { SessionAggregate } from './session-aggregate';
import { SessionParticipant } from './session-participant.entity';
import { SessionError } from './session.error';
import {
  advanceSession,
  evaluateAcceptedAnswers,
  finishSession,
  processSessionDeadline,
  startSession,
} from './session.rules';

function fixture(duration = 30) {
  const base = createSessionFixture(duration);
  const aggregate: SessionAggregate = {
    session: base.session,
    questions: base.questions,
    participants: [base.participant],
    answers: [],
    results: [],
  };
  return { ...base, aggregate };
}

describe('Reglas del dominio de sesiones', () => {
  it('rechaza comandos fuera de orden y actores ajenos antes de mutar', () => {
    const f = fixture();
    expect(() => startSession(f.aggregate, f.player.id, f.clock.now())).toThrow(
      new SessionError('HOST_REQUIRED'),
    );
    expect(() =>
      advanceSession(f.aggregate, f.questions[0].id, f.clock.now(), f.host.id),
    ).toThrow(new SessionError('INVALID_SESSION_STATE'));
    expect(f.session.status).toBe('WAITING');
  });

  it('exige preguntas y jugadores distintos del host', () => {
    const f = fixture();
    f.aggregate.questions = [];
    expect(() => startSession(f.aggregate, f.host.id, f.clock.now())).toThrow(
      new SessionError('SESSION_HAS_NO_QUESTIONS'),
    );
    f.aggregate.questions = f.questions;
    f.aggregate.participants = [
      Object.assign(new SessionParticipant(), f.participant, {
        userId: f.host.id,
      }),
    ];
    expect(() => startSession(f.aggregate, f.host.id, f.clock.now())).toThrow(
      new SessionError('SESSION_HAS_NO_PARTICIPANTS'),
    );
  });

  it.each([5, 15, 30, 120])(
    'inicia una sola vez con duración de %i segundos',
    (duration) => {
      const f = fixture(duration);
      startSession(f.aggregate, f.host.id, f.clock.now());
      const startedAt = f.session.startedAt;
      expect(
        f.questions[0].closesAt!.getTime() - f.questions[0].openedAt!.getTime(),
      ).toBe(duration * 1000);
      expect(f.questions[1].status).toBe('PENDING');
      expect(() => startSession(f.aggregate, f.host.id, f.clock.now())).toThrow(
        new SessionError('SESSION_ALREADY_STARTED'),
      );
      expect(f.session.startedAt).toBe(startedAt);
    },
  );

  it('no admite avanzar abierta ni acortar la revisión y rechaza avance obsoleto', () => {
    const f = fixture(15);
    startSession(f.aggregate, f.host.id, f.clock.now());
    const question = f.questions[0];
    expect(() =>
      advanceSession(f.aggregate, question.id, f.clock.now(), f.host.id),
    ).toThrow(new SessionError('QUESTION_NOT_CLOSED'));
    f.clock.advance(15_000);
    processSessionDeadline(
      f.aggregate,
      {
        sessionId: f.session.id,
        expectedQuestionId: question.id,
        kind: 'ANSWER',
        expectedDeadline: question.closesAt!,
      },
      f.clock.now(),
    );
    expect(() =>
      advanceSession(f.aggregate, question.id, f.clock.now(), f.host.id),
    ).toThrow(new SessionError('REVIEW_IN_PROGRESS'));
    f.clock.advance(4_999);
    expect(() =>
      advanceSession(f.aggregate, question.id, f.clock.now(), f.host.id),
    ).toThrow(new SessionError('REVIEW_IN_PROGRESS'));
    f.clock.advance(1);
    advanceSession(f.aggregate, question.id, f.clock.now(), f.host.id);
    expect(f.session.currentIndex).toBe(1);
    expect(() =>
      advanceSession(f.aggregate, question.id, f.clock.now(), f.host.id),
    ).toThrow(new SessionError('STALE_QUESTION'));
  });

  it('cierra por todos respondidos, ignora respuestas ajenas y no inventa ausencias', () => {
    const f = fixture();
    startSession(f.aggregate, f.host.id, f.clock.now());
    f.clock.advance(1_000);
    f.aggregate.answers.push(
      Object.assign(new Answer(), {
        sessionQuestionId: f.questions[1].id,
        participantId: f.participant.id,
        answeredAt: f.clock.now(),
        score: 100,
        choice: true,
      }),
    );
    expect(
      evaluateAcceptedAnswers(f.aggregate, f.questions[0].id, f.clock.now()),
    ).toBe(false);
    f.aggregate.answers.push(
      Object.assign(new Answer(), {
        sessionQuestionId: f.questions[0].id,
        participantId: f.participant.id,
        answeredAt: f.clock.now(),
        score: 100,
        choice: true,
      }),
    );
    expect(
      evaluateAcceptedAnswers(f.aggregate, f.questions[0].id, f.clock.now()),
    ).toBe(true);
    expect(f.questions[0].status).toBe('CLOSED');
    expect(
      f.questions[0].reviewEndsAt!.getTime() -
        f.questions[0].closedAt!.getTime(),
    ).toBe(5_000);
    expect(f.aggregate.answers).toHaveLength(2);
  });

  it('la respuesta en el límite exacto no cuenta y aporta cero', () => {
    const f = fixture(15);
    startSession(f.aggregate, f.host.id, f.clock.now());
    f.clock.advance(15_000);
    f.aggregate.answers.push(
      Object.assign(new Answer(), {
        sessionQuestionId: f.questions[0].id,
        participantId: f.participant.id,
        answeredAt: f.clock.now(),
        score: 100,
        choice: true,
      }),
    );
    evaluateAcceptedAnswers(f.aggregate, f.questions[0].id, f.clock.now());
    finishSession(f.aggregate, f.host.id, f.clock.now());
    expect(f.aggregate.results[0].totalScore).toBe(0);
  });

  it('recupera un vencimiento con retraso sin saltar preguntas nunca abiertas', () => {
    const f = fixture(15);
    startSession(f.aggregate, f.host.id, f.clock.now());
    const first = f.questions[0];
    const command = {
      sessionId: f.session.id,
      expectedQuestionId: first.id,
      kind: 'ANSWER' as const,
      expectedDeadline: first.closesAt!,
    };
    f.clock.advance(90_000);
    processSessionDeadline(f.aggregate, command, f.clock.now());
    expect(first.closedAt).toEqual(first.closesAt);
    expect(f.session.currentIndex).toBe(1);
    expect(f.questions[1].openedAt).toEqual(f.clock.now());
    expect(f.questions[1].closesAt!.getTime() - f.clock.now().getTime()).toBe(
      15_000,
    );
    expect(processSessionDeadline(f.aggregate, command, f.clock.now())).toBe(
      false,
    );
  });

  it('persiste ceros, empates densos y excluye preguntas nunca abiertas y al host', () => {
    const f = fixture();
    const other = Object.assign(new SessionParticipant(), f.participant, {
      id: randomUUID(),
      userId: randomUUID(),
    });
    const missing = Object.assign(new SessionParticipant(), f.participant, {
      id: randomUUID(),
      userId: randomUUID(),
    });
    f.aggregate.participants.push(other, missing);
    startSession(f.aggregate, f.host.id, f.clock.now());
    f.clock.advance(1_000);
    for (const participant of [f.participant, other])
      f.aggregate.answers.push(
        Object.assign(new Answer(), {
          sessionQuestionId: f.questions[0].id,
          participantId: participant.id,
          answeredAt: f.clock.now(),
          score: 100,
          choice: true,
        }),
      );
    f.aggregate.answers.push(
      Object.assign(new Answer(), {
        sessionQuestionId: f.questions[1].id,
        participantId: missing.id,
        answeredAt: f.clock.now(),
        score: 9999,
        choice: true,
      }),
    );
    finishSession(f.aggregate, f.host.id, f.clock.now());
    expect(f.aggregate.results.map((r) => [r.totalScore, r.rank])).toEqual([
      [3, 1],
      [3, 1],
      [0, 2],
    ]);
    expect(f.questions[1].status).toBe('PENDING');
  });

  it('finalizar en espera no abre preguntas y FINISHED es terminal', () => {
    const f = fixture();
    finishSession(f.aggregate, f.host.id, f.clock.now());
    expect(f.session.startedAt).toBeNull();
    expect(f.aggregate.results[0].totalScore).toBe(0);
    expect(f.questions.every((q) => q.status === 'PENDING')).toBe(true);
    for (const action of [
      () => finishSession(f.aggregate, f.host.id, f.clock.now()),
      () => startSession(f.aggregate, f.host.id, f.clock.now()),
      () =>
        advanceSession(
          f.aggregate,
          f.questions[0].id,
          f.clock.now(),
          f.host.id,
        ),
    ])
      expect(action).toThrow(new SessionError('SESSION_FINISHED'));
  });
});
