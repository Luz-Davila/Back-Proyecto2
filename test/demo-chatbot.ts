import 'reflect-metadata';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { ChatOrchestrator } from '../src/chatbot/chat-orchestrator.service';
import { DeepSeekClient } from '../src/chatbot/providers/deepseek.client';
import { QuizToolsExecutor } from '../src/chatbot/tools/quiz-tools.executor';
import type { QuizChatDto } from '../src/chatbot/dto/quiz-chat.dto';

/** Prueba opt-in del proveedor real. No importa módulos de BD ni imprime credenciales/contenido. */
async function main() {
  if (!process.argv.includes('--live'))
    throw new Error(
      'Usa --live únicamente si autorizas una consulta real a DeepSeek.',
    );
  config({ quiet: true });
  const client = new DeepSeekClient(new ConfigService());
  const orchestrator = new ChatOrchestrator(client, new QuizToolsExecutor());
  const refinement = process.argv.includes('--refinement');
  const retained = [
    {
      statement: 'Costa Rica es un país de América Central.',
      correctBoolean: true,
    },
    {
      statement: 'Francia es un país de América del Sur.',
      correctBoolean: false,
    },
  ];
  const request: QuizChatDto = refinement
    ? {
        messages: [
          {
            role: 'user',
            content: '2 preguntas de verdadero o falso sobre países.',
          },
          {
            role: 'assistant',
            content: 'Preparé dos afirmaciones para revisar.',
          },
          {
            role: 'user',
            content:
              'Agrega 2 países más. Conserva exactamente las dos afirmaciones revisadas y sus respuestas del borrador actual.',
          },
        ],
        currentDraft: { questions: retained },
      }
    : {
        messages: [
          {
            role: 'user',
            content:
              'Prepara dos afirmaciones claras de verdadero o falso sobre el sistema solar para sexto grado.',
          },
        ],
        requestedCount: 2,
      };
  const response = await orchestrator.respond(
    request,
    {
      title: refinement ? 'Países del mundo' : 'Prueba de sistema solar',
      description: null,
      questions: [],
      questionsCount: 0,
      truncated: false,
    },
    AbortSignal.timeout(90_000),
  );
  if (response.draft?.questions.length !== (refinement ? 4 : 2))
    throw new Error('El proveedor no entregó la cantidad solicitada.');
  if (
    refinement &&
    retained.some((question, index) => {
      const result = response.draft!.questions[index];
      return (
        result.statement !== question.statement ||
        result.correctBoolean !== question.correctBoolean
      );
    })
  )
    throw new Error('El proveedor no conservó las correcciones previas.');
  console.log(
    JSON.stringify({
      provider: 'DeepSeek',
      refinement,
      ...(refinement
        ? { retainedQuestionsUnchanged: true, addedQuestions: 2 }
        : {}),
      questions: response.draft.questions.length,
      booleanAnswers: response.draft.questions.every(
        (q) => typeof q.correctBoolean === 'boolean',
      ),
      databaseWrites: 0,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error && error.message.startsWith('Usa --live')
      ? error.message
      : 'La prueba real no pudo completarse; revisa configuración, saldo o disponibilidad del proveedor.',
  );
  process.exitCode = 1;
});
