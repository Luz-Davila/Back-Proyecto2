import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { Question } from './question.entity';
import { Quiz } from './quiz.entity';

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    @InjectRepository(Quiz)
    private readonly quizzes: Repository<Quiz>,
    private readonly dataSource: DataSource,
  ) {}

  async create(
    user: AuthenticatedUser,
    quizId: string,
    dto: CreateQuestionDto,
  ): Promise<Question> {
    await this.assertQuizOwned(user, quizId);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Question);
      const current = await repository.find({
        where: { quizId },
        order: { position: 'ASC' },
        select: { id: true },
      });

      const target = dto.position ?? current.length;
      if (target > current.length) {
        throw new BadRequestException(`La posición máxima es ${current.length}`);
      }

      const created = await repository.save(
        repository.create({
          quizId,
          statement: dto.statement,
          correctBoolean: dto.correctBoolean,
          imageKey: null,
          position: -(current.length + 1),
        }),
      );

      const ids = current.map((question) => question.id);
      ids.splice(target, 0, created.id);
      await this.applyOrder(repository, ids);

      created.position = target;
      return created;
    });
  }

  async update(
    user: AuthenticatedUser,
    questionId: string,
    dto: UpdateQuestionDto,
  ): Promise<Question> {
    const question = await this.findOwnedQuestion(user, questionId);

    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Question);

      if (dto.statement !== undefined) {
        question.statement = dto.statement;
      }
      if (dto.correctBoolean !== undefined) {
        question.correctBoolean = dto.correctBoolean;
      }
      await repository.save(question);

      if (dto.position !== undefined) {
        await this.moveTo(repository, question.quizId, question.id, dto.position);
        question.position = dto.position;
      }

      return question;
    });
  }

  async remove(user: AuthenticatedUser, questionId: string): Promise<void> {
    const question = await this.findOwnedQuestion(user, questionId);

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Question);
      await repository.remove(question);

      const remaining = await repository.find({
        where: { quizId: question.quizId },
        order: { position: 'ASC' },
        select: { id: true },
      });
      await this.applyOrder(
        repository,
        remaining.map((item) => item.id),
      );
    });
  }

  private async moveTo(
    repository: Repository<Question>,
    quizId: string,
    questionId: string,
    target: number,
  ): Promise<void> {
    const current = await repository.find({
      where: { quizId },
      order: { position: 'ASC' },
      select: { id: true },
    });

    if (target >= current.length) {
      throw new BadRequestException(`La posición máxima es ${current.length - 1}`);
    }

    const ids = current.map((question) => question.id).filter((id) => id !== questionId);
    ids.splice(target, 0, questionId);
    await this.applyOrder(repository, ids);
  }

  /**
   * La base exige posiciones únicas por quiz, así que primero se mueven todas
   * las preguntas a posiciones negativas y luego se asignan las definitivas.
   */
  private async applyOrder(repository: Repository<Question>, ids: string[]): Promise<void> {
    for (let index = 0; index < ids.length; index += 1) {
      await repository.update({ id: ids[index] }, { position: -(index + 1) });
    }
    for (let index = 0; index < ids.length; index += 1) {
      await repository.update({ id: ids[index] }, { position: index });
    }
  }

  private async assertQuizOwned(user: AuthenticatedUser, quizId: string): Promise<void> {
    const quiz = await this.quizzes.findOneBy({ id: quizId });

    if (!quiz) {
      throw new NotFoundException('Cuestionario no encontrado');
    }
    if (quiz.ownerId !== user.id) {
      throw new ForbiddenException('No puedes modificar preguntas de otro usuario');
    }
  }

  private async findOwnedQuestion(user: AuthenticatedUser, questionId: string): Promise<Question> {
    const question = await this.questions.findOne({
      where: { id: questionId },
      relations: ['quiz'],
    });

    if (!question) {
      throw new NotFoundException('Pregunta no encontrada');
    }
    if (question.quiz.ownerId !== user.id) {
      throw new ForbiddenException('No puedes modificar preguntas de otro usuario');
    }

    return question;
  }
}
