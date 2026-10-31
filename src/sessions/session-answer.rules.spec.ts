import { randomUUID } from 'crypto';
import { createSessionFixture } from '../../test/support/session-fixtures';
import { Answer } from './answer.entity';
import type { SessionAggregate } from './session-aggregate';
import {
  answerReceipt,
  authorizeAnswer,
  requireAnswerWindow,
} from './session-answer.rules';
import { startSession, finishSession } from './session.rules';
import { SessionError } from './session.error';

function fixture() {
  const f = createSessionFixture();
  const aggregate: SessionAggregate = {
    session: f.session,
    questions: f.questions,
    participants: [f.participant],
    answers: [],
    results: [],
  };
  const input = { sessionQuestionId: f.questions[0].id, choice: true };
  return { ...f, aggregate, input };
}

describe('Precedencia de autorización y ventana de respuesta', () => {
  it('WAITING y futura fallan; abierta admite desde openedAt inclusive', () => {
    const f = fixture();
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).toThrow(new SessionError('QUESTION_NOT_OPEN'));
    startSession(f.aggregate, f.host.id, f.clock.now());
    expect(() =>
      requireAnswerWindow(
        f.aggregate,
        f.input,
        new Date(f.clock.now().getTime() - 1),
      ),
    ).toThrow(new SessionError('QUESTION_NOT_OPEN'));
    expect(() =>
      requireAnswerWindow(
        f.aggregate,
        { ...f.input, sessionQuestionId: f.questions[1].id },
        f.clock.now(),
      ),
    ).toThrow(new SessionError('QUESTION_NOT_OPEN'));
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).not.toThrow();
    f.clock.advance(29999);
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).not.toThrow();
    f.clock.advance(1);
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).toThrow(new SessionError('ANSWER_TOO_LATE'));
  });

  it('cerrada anticipada/anterior no acepta nuevas; deadline precede FINISHED', () => {
    const f = fixture();
    startSession(f.aggregate, f.host.id, f.clock.now());
    f.questions[0].status = 'CLOSED';
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).toThrow(new SessionError('QUESTION_NOT_OPEN'));
    f.session.currentIndex = 1;
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).toThrow(new SessionError('QUESTION_NOT_OPEN'));
    finishSession(f.aggregate, f.host.id, f.clock.now());
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).toThrow(new SessionError('SESSION_FINISHED'));
    f.clock.advance(30000);
    expect(() =>
      requireAnswerWindow(f.aggregate, f.input, f.clock.now()),
    ).toThrow(new SessionError('ANSWER_TOO_LATE'));
  });

  it('pertenencia precede al duplicado y el comprobante no expone el score', () => {
    const f = fixture();
    const answer = Object.assign(new Answer(), {
      id: randomUUID(),
      ...f.input,
      participantId: f.participant.id,
      answeredAt: f.clock.now(),
      score: 3,
    });
    f.aggregate.answers.push(answer);
    f.session.status = 'FINISHED';
    f.questions[0].status = 'CLOSED';
    const changed = { ...f.input, choice: false };
    expect(() => authorizeAnswer(f.aggregate, randomUUID(), changed)).toThrow(
      new SessionError('SESSION_NOT_FOUND'),
    );
    expect(() => authorizeAnswer(f.aggregate, f.host.id, changed)).toThrow(
      new SessionError('HOST_CANNOT_PARTICIPATE'),
    );
    expect(() => authorizeAnswer(f.aggregate, f.player.id, changed)).toThrow(
      new SessionError('ANSWER_ALREADY_SUBMITTED'),
    );
    expect(authorizeAnswer(f.aggregate, f.player.id, f.input).existing).toBe(
      answer,
    );
    expect(answerReceipt(answer)).toEqual({
      id: answer.id,
      ...f.input,
      answeredAt: f.clock.now().toISOString(),
    });
  });
});
