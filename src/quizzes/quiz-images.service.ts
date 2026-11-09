import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { assertValidImage, extensionFor } from './image-validation';
import { QuizzesService } from './quizzes.service';

const SIGNED_URL_SECONDS = 600;

export interface QuizImage {
  id: string;
  imageKey: string;
  imageUrl: string;
}

@Injectable()
export class QuizImagesService {
  constructor(
    private readonly quizzes: QuizzesService,
    private readonly storage: StorageService,
  ) {}

  async replace(
    user: AuthenticatedUser,
    quizId: string,
    file: Express.Multer.File | undefined,
  ): Promise<QuizImage> {
    if (!file) {
      throw new BadRequestException('Falta el archivo de imagen en el campo "file"');
    }

    const type = assertValidImage(file);
    const quiz = await this.quizzes.findOwned(user, quizId);

    const key = `quizzes/${quiz.id}/cover/${randomUUID()}.${extensionFor(type)}`;
    await this.storage.upload(key, file.buffer, type);

    const previousKey = quiz.imageKey;
    await this.quizzes.updateImageKey(quiz.id, key);

    if (previousKey) {
      await this.storage.remove(previousKey);
    }

    return {
      id: quiz.id,
      imageKey: key,
      imageUrl: await this.storage.signedUrl(key, SIGNED_URL_SECONDS),
    };
  }

  async remove(user: AuthenticatedUser, quizId: string): Promise<void> {
    const quiz = await this.quizzes.findOwned(user, quizId);

    if (!quiz.imageKey) {
      throw new NotFoundException('El cuestionario no tiene imagen');
    }

    await this.storage.remove(quiz.imageKey);
    await this.quizzes.updateImageKey(quiz.id, null);
  }
}
