import { Injectable } from '@nestjs/common';
import { QuestionDraftDto } from '../../quizzes/dto/question-draft.dto';
import type { QuizContext, ToolCall } from '../contracts/chat.contracts';
import { validateDto } from '../../common/validate-dto';

@Injectable()
export class QuizToolsExecutor {
  async execute(call: ToolCall, context: QuizContext, requestedCount?: number) {
    try {
      if (call.function.arguments.length > 32_000) throw new Error();
      const value: unknown = JSON.parse(call.function.arguments);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error();
      if (
        call.function.name === 'getQuizContext' &&
        Object.keys(value).length === 0
      ) {
        return { result: JSON.stringify(context), draft: null };
      }
      if (call.function.name === 'proposeQuestions') {
        const draft = await validateDto(QuestionDraftDto, value);
        if (
          requestedCount !== undefined &&
          draft.questions.length !== requestedCount
        ) {
          return {
            result: JSON.stringify({
              error: `La propuesta debe contener exactamente ${requestedCount} preguntas.`,
            }),
            draft: null,
          };
        }
        return {
          result: JSON.stringify({
            prepared: draft.questions.length,
            saved: false,
          }),
          draft,
        };
      }
    } catch {
      // No devolver argumentos, excepciones ni contenido externo en errores.
    }
    return {
      result: JSON.stringify({
        error:
          'Herramienta no permitida o argumentos inválidos. Corrige la propuesta.',
      }),
      draft: null,
    };
  }
}
