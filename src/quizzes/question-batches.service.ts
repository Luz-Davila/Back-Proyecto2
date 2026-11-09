import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service';
import { ProfilesService } from '../profiles/profiles.service';
import { validateDto } from '../common/validate-dto';
import { CreateQuestionBatchDto } from './dto/create-question-batch.dto';
import {
  QuestionBatchOperation,
  type QuestionBatchReceipt,
} from './question-batch-operation.entity';
import { Question } from './question.entity';
import { Quiz } from './quiz.entity';
import { lockQuizForWrite } from './quiz-write-coordinator';

@Injectable()
export class QuestionBatchesService {
  constructor(
    private readonly source: DataSource,
    private readonly profiles: ProfilesService,
  ) {}

  async create(
    user: AuthenticatedUser,
    quizId: string,
    input: CreateQuestionBatchDto,
  ): Promise<QuestionBatchReceipt> {
    const dto = await validateDto(CreateQuestionBatchDto, input);
    await this.profiles.requireTeacher(user);
    const questions = dto.questions.map(({ statement, correctBoolean }) => ({
      statement,
      correctBoolean,
    }));
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(questions))
      .digest('hex');
    return this.source.transaction(async (manager) => {
      await lockQuizForWrite(manager, user, quizId, true);
      const key = { userId: user.id, quizId, operationId: dto.operationId };
      const previous = await manager.findOneBy(QuestionBatchOperation, key);
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw new ConflictException({
            code: 'OPERATION_CONFLICT',
            message:
              'Este identificador ya confirmó un lote distinto. Revisa el cuestionario.',
          });
        return previous.receipt;
      }
      const offset = await manager.countBy(Question, { quizId });
      const receipt: QuestionBatchReceipt = {
        operationId: dto.operationId,
        questions: [],
      };
      for (const [index, value] of questions.entries()) {
        const question = await manager.save(
          Question,
          manager.create(Question, {
            ...value,
            kind: 'boolean',
            options: null,
            correctIndexes: null,
            quizId,
            position: offset + index,
            imageKey: null,
            durationSeconds: null,
          }),
        );
        receipt.questions.push({
          id: question.id,
          quizId,
          ...value,
          position: question.position,
          imageKey: null,
          imageUrl: null,
        });
      }
      await manager.update(Quiz, { id: quizId }, { updatedAt: new Date() });
      await manager.insert(QuestionBatchOperation, {
        ...key,
        payloadHash,
        receipt,
      });
      return receipt;
    });
  }
}
