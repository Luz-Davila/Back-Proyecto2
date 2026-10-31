import type { Answer } from './answer.entity';
import type { GameResult } from './game-result.entity';
import type { GameSession } from './game-session.entity';
import type { SessionParticipant } from './session-participant.entity';
import type { SessionQuestion } from './session-question.entity';

export interface SessionAggregate {
  session: GameSession;
  questions: SessionQuestion[];
  participants: SessionParticipant[];
  answers: Answer[];
  results: GameResult[];
}
