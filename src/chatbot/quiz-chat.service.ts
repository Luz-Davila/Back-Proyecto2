import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service';
import { ProfilesService } from '../profiles/profiles.service';
import { QuizzesService } from '../quizzes/quizzes.service';
import { chatError } from './chat.errors';
import { ChatLimitsService } from './chat-limits.service';
import { ChatOrchestrator } from './chat-orchestrator.service';
import { QuizChatDto } from './dto/quiz-chat.dto';
import { validateDto } from '../common/validate-dto';
import { DeepSeekClient } from './providers/deepseek.client';

@Injectable()
export class QuizChatService {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly quizzes: QuizzesService,
    private readonly client: DeepSeekClient,
    private readonly limits: ChatLimitsService,
    private readonly orchestrator: ChatOrchestrator,
  ) {}

  async respond(user: AuthenticatedUser, quizId: string, input: QuizChatDto) {
    if (Buffer.byteLength(JSON.stringify(input)) > 96 * 1024)
      throw chatError(
        413,
        'PAYLOAD_TOO_LARGE',
        'La conversación es demasiado larga. Inicia una nueva conservando la propuesta.',
      );
    const request = await validateDto(QuizChatDto, input);
    if (request.messages.at(-1)?.role !== 'user')
      throw chatError(
        400,
        'VALIDATION_ERROR',
        'La conversación debe terminar con tu mensaje.',
      );
    await this.profiles.requireTeacher(user);
    const context = await this.quizzes.assistantContext(user, quizId);
    this.client.assertConfigured();
    const release = this.limits.acquire(user.id);
    try {
      return await this.orchestrator.respond(
        request,
        context,
        AbortSignal.timeout(90_000),
      );
    } finally {
      release();
    }
  }
}
