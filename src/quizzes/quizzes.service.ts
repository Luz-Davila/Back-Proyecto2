import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
export type QuizWithImage = Quiz & { imageUrl: string | null };
export type QuizDetail = Omit<Quiz, 'questions'> & {
  imageUrl: string | null;
  questions: QuestionWithImage[];
};

const SIGNED_URL_SECONDS = 600;

@Injectable()
export class QuizzesService {
  constructor(
    @InjectRepository(Quiz)
    private readonly quizzes: Repository<Quiz>,
    @InjectRepository(Question)
    private readonly questions: Repository<Question>,
    private readonly profiles: ProfilesService,
    private readonly storage: StorageService,
  ) {}

  async list(user: AuthenticatedUser): Promise<Array<QuizWithImage & { questionsCount: number }>> {
    const quizzes = (await this.quizzes
      .createQueryBuilder('quiz')
      .where('quiz.ownerId = :ownerId', { ownerId: user.id })
      .loadRelationCountAndMap('quiz.questionsCount', 'quiz.questions')
      .orderBy('quiz.updatedAt', 'DESC')
      .getMany()) as Array<Quiz & { questionsCount: number }>;

    return Promise.all(quizzes.map(async (quiz) => ({ ...quiz, imageUrl: await this.signedUrl(quiz.imageKey) })));
  }

  async create(user: AuthenticatedUser, dto: CreateQuizDto): Promise<Quiz> {
    await this.profiles.requireTeacher(user);

    const quiz = this.quizzes.create({
      ownerId: user.id,
      title: dto.title,
      description: dto.description ?? null,
      imageKey: null,
    });

    return this.quizzes.save(quiz);
  }

  async duplicate(user: AuthenticatedUser, id: string): Promise<Quiz> {
    await this.profiles.requireTeacher(user);
    const source = await this.quizzes.findOne({
      where: { id, ownerId: user.id },
      relations: ['questions'],
      order: { questions: { position: 'ASC' } },
    });
    if (!source) throw new NotFoundException('Cuestionario no encontrado');

    const copy = await this.quizzes.save(
      this.quizzes.create({
        ownerId: user.id,
        title: copyTitle(source.title),
        description: source.description,
        imageKey: null,
      }),
    );
    const copiedKeys: string[] = [];
    try {
      if (source.imageKey) {
        const imageKey = copiedImageKey(copy.id, 'cover', source.imageKey);
        await this.storage.copy(source.imageKey, imageKey);
        copiedKeys.push(imageKey);
        copy.imageKey = imageKey;
        await this.quizzes.save(copy);
      }
      for (const question of [...source.questions].sort(
        (a, b) => a.position - b.position,
      )) {
        let imageKey: string | null = null;
        if (question.imageKey) {
          imageKey = copiedImageKey(copy.id, 'questions', question.imageKey);
          await this.storage.copy(question.imageKey, imageKey);
          copiedKeys.push(imageKey);
        }
        await this.questions.save(
          this.questions.create({
            quizId: copy.id,
            statement: question.statement,
            kind: question.kind,
            correctBoolean: question.correctBoolean,
            options: question.options,
            correctIndexes: question.correctIndexes,
            durationSeconds: question.durationSeconds,
            imageKey,
            position: question.position,
          }),
        );
      }
    } catch (error) {
      await Promise.all(copiedKeys.map((key) => this.storage.remove(key)));
      await this.quizzes.remove(copy);
      throw error;
    }
    return copy;
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

    return { ...quiz, imageUrl: await this.signedUrl(quiz.imageKey), questions };
  }

  /** Frontera allow-list para la IA; nunca firmar ni enviar imágenes/IDs. */
  async assistantContext(user: AuthenticatedUser, id: string) {
    const quiz = await this.quizzes.findOne({
      where: { id, ownerId: user.id },
      relations: ['questions'],
      order: { questions: { position: 'ASC' } },
    });
    if (!quiz) throw new NotFoundException('Cuestionario no encontrado');
    return {
      title: quiz.title,
      description: quiz.description,
      questionsCount: quiz.questions.length,
      truncated: quiz.questions.length > 30,
      questions: quiz.questions
        .slice(0, 30)
        .map(({ statement, kind, correctBoolean, options, correctIndexes }) => {
          const resolvedKind = kind === 'multiple' ? ('multiple' as const) : ('boolean' as const);
          return {
            statement,
            kind: resolvedKind,
            correctBoolean,
            options: resolvedKind === 'multiple' ? options : null,
            correctIndexes: resolvedKind === 'multiple' ? correctIndexes : null,
          };
        }),
    };
  }

  async update(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateQuizDto,
  ): Promise<Quiz> {
    const quiz = await this.findOwned(user, id);

    if (dto.title !== undefined) {
      quiz.title = dto.title;
    }
    if (dto.description !== undefined) {
      quiz.description = dto.description;
    }

    return this.quizzes.save(quiz);
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const quiz = await this.findOwned(user, id);
    if (quiz.imageKey) {
      await this.storage.remove(quiz.imageKey);
    }
    await this.quizzes.remove(quiz);
  }

  async findOwned(user: AuthenticatedUser, id: string): Promise<Quiz> {
    const quiz = await this.quizzes.findOneBy({ id });

    if (!quiz) {
      throw new NotFoundException('Cuestionario no encontrado');
    }
    if (quiz.ownerId !== user.id) {
      throw new ForbiddenException(
        'No puedes modificar un cuestionario de otro usuario',
      );
    }

    return quiz;
  }

  async updateImageKey(quizId: string, imageKey: string | null): Promise<void> {
    await this.quizzes.update({ id: quizId }, { imageKey });
  }

  private signedUrl(imageKey: string | null | undefined): Promise<string | null> {
    return imageKey ? this.storage.signedUrl(imageKey, SIGNED_URL_SECONDS) : Promise.resolve(null);
  }
}

function copyTitle(title: string): string {
  const next = `Copia de ${title}`;
  return next.length <= 120 ? next : next.slice(0, 120);
}

function copiedImageKey(
  quizId: string,
  folder: 'cover' | 'questions',
  sourceKey: string,
): string {
  const extension = sourceKey.split('.').pop()?.toLowerCase() ?? '';
  const safe = /^[a-z0-9]+$/.test(extension) ? extension : 'png';
  return `quizzes/${quizId}/${folder}/${randomUUID()}.${safe}`;
}
