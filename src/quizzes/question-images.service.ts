import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { AuthenticatedUser } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { assertValidImage, extensionFor } from './image-validation';
import { QuestionsService } from './questions.service';

const SIGNED_URL_SECONDS = 600;

export interface QuestionImage {
  id: string;
  imageKey: string;
  imageUrl: string;
}

@Injectable()
export class QuestionImagesService {
  constructor(
    private readonly questions: QuestionsService,
    private readonly storage: StorageService,
  ) {}

  async replace(
    user: AuthenticatedUser,
    questionId: string,
    file: Express.Multer.File | undefined,
  ): Promise<QuestionImage> {
    if (!file) {
      throw new BadRequestException('Falta el archivo de imagen en el campo "file"');
    }

    const type = assertValidImage(file);
    const question = await this.questions.findOwned(user, questionId);

    const key = `quizzes/${question.quizId}/questions/${randomUUID()}.${extensionFor(type)}`;
    await this.storage.upload(key, file.buffer, type);

    const previousKey = question.imageKey;
    await this.questions.updateImageKey(question.id, key);

    if (previousKey) {
      await this.storage.remove(previousKey);
    }

    return {
      id: question.id,
      imageKey: key,
      imageUrl: await this.storage.signedUrl(key, SIGNED_URL_SECONDS),
    };
  }

  async remove(user: AuthenticatedUser, questionId: string): Promise<void> {
    const question = await this.questions.findOwned(user, questionId);

    if (!question.imageKey) {
      throw new NotFoundException('La pregunta no tiene imagen');
    }

    await this.storage.remove(question.imageKey);
    await this.questions.updateImageKey(question.id, null);
  }
}
