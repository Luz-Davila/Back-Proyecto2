import {
  ClosedScoreVerifier,
  verifyAnswerRow,
} from '../../test/support/answer-benchmark-verifier';
import { createSessionFixture } from '../../test/support/session-fixtures';

describe('Verificador del benchmark', () => {
  it('un ACK perdido no altera las comprobaciones de datos persistidos', () => {
    const f = createSessionFixture();
    const question = f.questions[0];
    question.openedAt = f.clock.now();
    question.closesAt = new Date(f.clock.now().getTime() + 30000);
    const answer = {
      id: 'answer',
      sessionQuestionId: question.id,
      participantId: f.participant.id,
      choice: true,
      choiceIndex: null,
      answeredAt: f.clock.now(),
      score: 3,
    };
    expect(
      verifyAnswerRow(
        answer,
        question,
        true,
        f.clock.now().getTime(),
        f.clock.now().getTime(),
      ),
    ).toEqual({ choices: true, dates: true, receiptMatches: null });
    expect(
      verifyAnswerRow(answer, question, false, 0, Date.now()),
    ).toMatchObject({ choices: false });
    expect(
      verifyAnswerRow(
        { ...answer, answeredAt: question.closesAt },
        question,
        true,
        0,
        Date.now(),
      ),
    ).toMatchObject({ dates: false });
    expect(
      verifyAnswerRow(answer, question, true, 0, Date.now(), {
        id: 'wrong',
        sessionQuestionId: question.id,
        answeredAt: answer.answeredAt.toISOString(),
        choice: true,
      }),
    ).toMatchObject({ choices: true, dates: true, receiptMatches: false });
  });

  it('ignora puntajes de una pregunta abierta y detecta cambios de una ya calificada', () => {
    const verifier = new ClosedScoreVerifier();
    const questions = [
      { id: 'closed', scoredAt: new Date() },
      { id: 'open', scoredAt: null },
    ];
    const answers = [
      { id: 'a', sessionQuestionId: 'closed', score: 3 },
      { id: 'b', sessionQuestionId: 'open', score: 0 },
    ];
    expect(verifier.observe(questions, answers)).toBe(true);
    answers[1].score = 3;
    questions[1].scoredAt = new Date();
    expect(verifier.observe(questions, answers)).toBe(true);
    answers[0].score = 1;
    expect(verifier.observe(questions, answers)).toBe(false);
  });
});
