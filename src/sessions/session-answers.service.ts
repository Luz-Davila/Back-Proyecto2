import { Injectable, Optional } from '@nestjs/common';
import { GameTelemetry } from './game-telemetry';
import type { AuthenticatedUser } from '../auth/auth.service';
import { SessionAdmissions } from './session-admissions';
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
    private readonly admissions: SessionAdmissions,
    @Optional() private readonly telemetry?: GameTelemetry,
  ) {}

  async submit(
    user: AuthenticatedUser,
    input: SubmitAnswerInput,
  ): Promise<AnswerReceipt> {
    try {
      return await this.admissions.run(
        input.sessionQuestionId,
        () => this.repository.sessionForQuestion(input.sessionQuestionId),
        async (admission) =>
          this.accept(
            user,
            input,
            await admission.resolveSession(),
            admission.answeredAt,
            admission.waitMs,
          ),
      );
    } catch (error) {
      this.telemetry?.answerFailed(error);
      throw error;
    }
  }

  private async accept(
    user: AuthenticatedUser,
    input: SubmitAnswerInput,
    sessionId: string,
    answeredAt: Date,
    previousWaitMs: number,
  ): Promise<AnswerReceipt> {
    // A unique violation aborts the transaction. Recover only that constraint,
    // by revalidating the winning row under a fresh transaction/room lock.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.repository.answerLocked<{
          receipt: AnswerReceipt;
          disposition: 'accepted' | 'replayed';
        }>(
          sessionId,
          input.sessionQuestionId,
          user.id,
          async (manager, context) => {
            const aggregate = {
              session: context.session,
              questions: [context.question],
              participants: context.participant ? [context.participant] : [],
              answers: context.existing ? [context.existing] : [],
              results: [],
            };
            const { existing, question } = authorizeAnswer(
              aggregate,
              user.id,
              input,
            );
            const multiple = (question.kind ?? 'boolean') === 'multiple';
            if (multiple) {
              if (
                !Number.isInteger(input.choiceIndex) ||
                (input.choiceIndex as number) < 0 ||
                (input.choiceIndex as number) > 3
              )
                throw new SessionError('VALIDATION_ERROR');
            } else if (typeof input.choice !== 'boolean') {
              throw new SessionError('VALIDATION_ERROR');
            }
            if (existing)
              return {
                value: {
                  receipt: answerReceipt(existing),
                  disposition: 'replayed' as const,
                },
              };
            requireAnswerWindow(aggregate, input, answeredAt);
            const inserted = await this.repository.insertAcceptedAnswer(
              manager,
              context,
              input,
              answeredAt,
            );
            const value = {
              receipt: answerReceipt(inserted.answer),
              disposition: 'accepted' as const,
            };
            if (inserted.complete) {
              const snapshot = await this.repository.snapshot(
                manager,
                context.session,
              );
              const before = structuredClone(snapshot);
              if (
                evaluateAcceptedAnswers(
                  snapshot,
                  input.sessionQuestionId,
                  this.clock.now(),
                )
              ) {
                await this.repository.persist(manager, snapshot, before);
                return { value, before, after: snapshot };
              }
            }
            return { value };
          },
          attempt === 0 ? previousWaitMs : 0,
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
