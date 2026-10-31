import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../../src/auth/auth.service';
import { GameSession } from '../../src/sessions/game-session.entity';
import { SessionParticipant } from '../../src/sessions/session-participant.entity';
import { SessionQuestion } from '../../src/sessions/session-question.entity';
import { SessionClock } from '../../src/sessions/session.clock';
import type { QuestionDurationSeconds } from '../../src/sessions/session.contracts';

export class ManualSessionClock extends SessionClock {
  private milliseconds: number;

  constructor(initial = new Date('2026-10-28T12:00:00.000Z')) {
    super();
    this.milliseconds = initial.getTime();
    if (!Number.isFinite(this.milliseconds)) {
      throw new Error('El instante inicial del reloj debe ser válido');
    }
  }

  now(): Date {
    return new Date(this.milliseconds);
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error(
        'El reloj solo puede avanzar una duración finita no negativa',
      );
    }
    this.milliseconds += milliseconds;
  }
}

export function createSessionFixture(
  questionDurationSeconds: QuestionDurationSeconds = 30,
) {
  const clock = new ManualSessionClock();
  const host: AuthenticatedUser = {
    id: randomUUID(),
    displayName: 'Host de prueba',
  };
  const player: AuthenticatedUser = {
    id: randomUUID(),
    displayName: 'Jugador de prueba',
  };
  const quizId = randomUUID();
  const session: GameSession = Object.assign(new GameSession(), {
    id: randomUUID(),
    code: 'ABC234',
    quizId,
    hostId: host.id,
    quizTitle: 'Cuestionario de prueba',
    questionDurationSeconds,
    reviewDurationSeconds: 5,
    status: 'WAITING',
    currentIndex: -1,
    startedAt: null,
    finishedAt: null,
    createdAt: clock.now(),
  });
  const participant: SessionParticipant = Object.assign(
    new SessionParticipant(),
    {
      id: randomUUID(),
      sessionId: session.id,
      userId: player.id,
      displayName: player.displayName,
      joinedAt: clock.now(),
    },
  );
  const questions: SessionQuestion[] = [true, false].map(
    (correctBoolean, position) =>
      Object.assign(new SessionQuestion(), {
        id: randomUUID(),
        sessionId: session.id,
        originalQuestionId: randomUUID(),
        position,
        statement: `Pregunta ${position + 1}`,
        correctBoolean,
        imageKey: null,
        status: 'PENDING',
        openedAt: null,
        closesAt: null,
        closedAt: null,
        reviewEndsAt: null,
        scoredAt: null,
      }),
  );

  return { clock, host, player, session, participant, questions };
}
