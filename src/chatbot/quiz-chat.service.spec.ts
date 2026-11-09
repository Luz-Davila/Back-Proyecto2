import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ProfilesService } from '../profiles/profiles.service';
import type { QuizzesService } from '../quizzes/quizzes.service';
import type { DeepSeekClient } from './providers/deepseek.client';
import { ChatLimitsService } from './chat-limits.service';
import type { ChatOrchestrator } from './chat-orchestrator.service';
import { chatError } from './chat.errors';
import { QuizChatService } from './quiz-chat.service';

describe('Acceso y aislamiento de QuizChatService', () => {
  const user = { id: 'teacher' };
  const input = {
    messages: [{ role: 'user' as const, content: 'Tres preguntas' }],
  };
  const profiles = { requireTeacher: jest.fn() };
  const quizzes = { assistantContext: jest.fn() };
  const provider = { assertConfigured: jest.fn() };
  const orchestrator = { respond: jest.fn() };
  let service: QuizChatService;

  beforeEach(() => {
    jest.resetAllMocks();
    profiles.requireTeacher.mockResolvedValue({ role: 'teacher' });
    quizzes.assistantContext.mockResolvedValue({ title: 'Quiz' });
    orchestrator.respond.mockResolvedValue({
      reply: '¿Qué tema?',
      draft: null,
    });
    service = new QuizChatService(
      profiles as unknown as ProfilesService,
      quizzes as unknown as QuizzesService,
      provider as unknown as DeepSeekClient,
      new ChatLimitsService(),
      orchestrator as unknown as ChatOrchestrator,
    );
  });

  it('verifica profesor y propietario antes de llamar al proveedor', async () => {
    profiles.requireTeacher.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.respond(user, 'quiz', input)).rejects.toThrow(
      ForbiddenException,
    );
    expect(quizzes.assistantContext).not.toHaveBeenCalled();
    quizzes.assistantContext.mockRejectedValueOnce(new NotFoundException());
    await expect(service.respond(user, 'ajeno', input)).rejects.toThrow(
      NotFoundException,
    );
    expect(provider.assertConfigured).not.toHaveBeenCalled();
    expect(orchestrator.respond).not.toHaveBeenCalled();
  });

  it('rechaza último mensaje assistant y exceso de bytes', async () => {
    await expect(
      service.respond(user, 'quiz', {
        messages: [{ role: 'assistant', content: 'Hola' }],
      }),
    ).rejects.toThrow();
    const messages = Array.from({ length: 40 }, () => ({
      role: 'user' as const,
      content: 'á'.repeat(2000),
    }));
    await expect(service.respond(user, 'quiz', { messages })).rejects.toThrow(
      'conversación es demasiado larga',
    );
    expect(orchestrator.respond).not.toHaveBeenCalled();
  });

  it('usa el asistente local si DeepSeek no está configurado', async () => {
    provider.assertConfigured.mockImplementation(() => {
      throw chatError(
        503,
        'CHAT_NOT_CONFIGURED',
        'El asistente no está configurado',
      );
    });
    const result = await service.respond(user, 'quiz', {
      messages: [
        {
          role: 'user',
          content: '10 preguntas de fotosíntesis para sexto grado',
        },
      ],
    });
    expect(orchestrator.respond).not.toHaveBeenCalled();
    expect(result.draft?.questions).toHaveLength(10);
    expect(result.reply).toMatch(/fotosíntesis/i);
  });

  it('libera el turno incluso cuando falla el proveedor', async () => {
    orchestrator.respond.mockRejectedValueOnce(new Error('Fallo simulado'));
    await expect(service.respond(user, 'quiz', input)).rejects.toThrow();
    await expect(service.respond(user, 'quiz', input)).resolves.toEqual({
      reply: '¿Qué tema?',
      draft: null,
    });
  });
});
