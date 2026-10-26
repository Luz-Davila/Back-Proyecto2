import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service';
import { ProfilesService } from '../profiles/profiles.service';
import { StorageService } from '../storage/storage.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { Question } from './question.entity';
import { Quiz } from './quiz.entity';

export type QuestionWithImage = Question & { imageUrl: string | null };
export type QuizDetail = Omit<Quiz, 'questions'> & { questions: QuestionWithImage[] };

const SIGNED_URL_SECONDS = 600;

@Injectable()
export class QuizzesService {
  constructor(
    @InjectRepository(Quiz)
    private readonly quizzes: Repository<Quiz>,
    private readonly profiles: ProfilesService,
    private readonly storage: StorageService,
  ) {}

  list(user: AuthenticatedUser): Promise<Quiz[]> {
    return this.quizzes
      .createQueryBuilder('quiz')
      .where('quiz.ownerId = :ownerId', { ownerId: user.id })
      .loadRelationCountAndMap('quiz.questionsCount', 'quiz.questions')
      .orderBy('quiz.updatedAt', 'DESC')
      .getMany();
  }

  async create(user: AuthenticatedUser, dto: CreateQuizDto): Promise<Quiz> {
    await this.profiles.getOrCreate(user);

    const quiz = this.quizzes.create({
      ownerId: user.id,
      title: dto.title,
      description: dto.description ?? null,
    });

    return this.quizzes.save(quiz);
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<QuizDetail> {
    const quiz = await this.quizzes.findOne({
      where: { id, ownerId: user.id },
      relations: ['questions'],
      order: { questions: { position: 'ASC' } },
    });

    if (!quiz) {
      throw new NotFoundException('Cuestionario no encontrado');
    }

    const questions = await Promise.all(
      quiz.questions.map(async (question) => ({
        ...question,
        imageUrl: question.imageKey
          ? await this.storage.signedUrl(question.imageKey, SIGNED_URL_SECONDS)
          : null,
      })),
    );

    return { ...quiz, questions };
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateQuizDto): Promise<Quiz> {
    const quiz = await this.findOneForWrite(user, id);

    if (dto.title !== undefined) {
      quiz.title = dto.title;
    }
    if (dto.description !== undefined) {
      quiz.description = dto.description;
    }

    return this.quizzes.save(quiz);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const quiz = await this.findOneForWrite(user, id);
    await this.quizzes.remove(quiz);
  }

  private async findOneForWrite(user: AuthenticatedUser, id: string): Promise<Quiz> {
    const quiz = await this.quizzes.findOneBy({ id });

    if (!quiz) {
      throw new NotFoundException('Cuestionario no encontrado');
    }
    if (quiz.ownerId !== user.id) {
      throw new ForbiddenException('No puedes modificar un cuestionario de otro usuario');
    }

    return quiz;
  }
}
