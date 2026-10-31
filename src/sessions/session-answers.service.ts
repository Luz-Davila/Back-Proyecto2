import { Injectable, Optional } from '@nestjs/common';
import { GameTelemetry } from './game-telemetry';
import type { AuthenticatedUser } from '../auth/auth.service';
import { Answer } from './answer.entity';
import { SessionsRepository } from './sessions.repository';
import { SessionClock } from './session.clock';
import {
  answerReceipt,
  authorizeAnswer,
  requireAnswerWindow,
} from './session-answer.rules';
import { evaluateAcceptedAnswers } from './session.rules';
import { isUniqueConstraintError } from './session-code.generator';
import { SessionError } from './session.error';
import type { AnswerReceipt, SubmitAnswerInput } from './session.contracts';

@Injectable()
export class SessionAnswersService {
  constructor(
    private readonly repository: SessionsRepository,
    private readonly clock: SessionClock,
    @Optional() private readonly telemetry?: GameTelemetry,
  ) {}

  async submit(
    user: AuthenticatedUser,
    input: SubmitAnswerInput,
  ): Promise<AnswerReceipt> {
    try {
      return await this.accept(user, input);
    } catch (error) {
      this.telemetry?.answerFailed(error);
      throw error;
    }
  }

  private async accept(
    user: AuthenticatedUser,
    input: SubmitAnswerInput,
  ): Promise<AnswerReceipt> {
    if (typeof input.choice !== 'boolean')
      throw new SessionError('VALIDATION_ERROR');
    const sessionId = await this.repository.sessionForQuestion(
      input.sessionQuestionId,
    );
    // A unique violation aborts the transaction. Recover only that constraint,
    // by revalidating the winning row under a fresh transaction/room lock.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.repository.locked(
          { id: sessionId },
          async (manager, session) => {
            const aggregate = await this.repository.snapshot(manager, session);
            const { participant, existing } = authorizeAnswer(
              aggregate,
              user.id,
              input,
            );
            if (existing)
              return {
                receipt: answerReceipt(existing),
                disposition: 'replayed' as const,
              };
            const now = this.clock.now();
            requireAnswerWindow(aggregate, input, now);
            const answer = await manager.save(
              Answer,
              manager.create(Answer, {
                sessionQuestionId: input.sessionQuestionId,
                participantId: participant.id,
                choice: input.choice,
                answeredAt: now,
                score: 0,
              }),
            );
            aggregate.answers.push(answer);
            if (
              evaluateAcceptedAnswers(aggregate, input.sessionQuestionId, now)
            ) {
              await this.repository.persist(manager, aggregate);
            }
            return {
              receipt: answerReceipt(answer),
              disposition: 'accepted' as const,
            };
          },
        );
        this.telemetry?.answer(result.disposition);
        return result.receipt;
      } catch (error) {
        if (
          attempt !== 0 ||
          !isUniqueConstraintError(error, 'UQ_75600bfabe6672de6fec13b44fe')
        )
          throw error;
      }
    }
    throw new SessionError('INTERNAL_ERROR');
  }
}
