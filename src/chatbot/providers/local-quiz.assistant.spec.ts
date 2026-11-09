import { localQuizRespond } from './local-quiz.assistant';
import type { QuizContext } from '../contracts/chat.contracts';

const context: QuizContext = {
  title: 'Ciencias',
  description: null,
  questionsCount: 0,
  truncated: false,
  questions: [],
};

describe('Asistente local de cuestionarios', () => {
  it('prepara 10 preguntas de fotosíntesis para sexto grado', () => {
    const result = localQuizRespond(
      {
        messages: [
          {
            role: 'user',
            content: '10 preguntas de fotosíntesis para sexto grado',
          },
        ],
      },
      context,
    );
    expect(result.draft?.questions).toHaveLength(10);
    expect(result.draft?.questions.every((item) => item.statement.length <= 500)).toBe(true);
    expect(result.draft?.questions.some((item) => item.correctBoolean)).toBe(true);
    expect(result.draft?.questions.some((item) => !item.correctBoolean)).toBe(true);
    expect(result.reply).toMatch(/fotosíntesis/i);
  });

  it('prepara preguntas de 4 opciones cuando se piden', () => {
    const result = localQuizRespond(
      {
        messages: [
          {
            role: 'user',
            content: '4 preguntas de 4 opciones de fotosíntesis',
          },
        ],
      },
      context,
    );
    expect(result.draft?.questions).toHaveLength(4);
    expect(result.draft?.questions.every((item) => item.kind === 'multiple')).toBe(true);
    expect(result.draft?.questions.every((item) => item.options?.length === 4)).toBe(true);
    expect(result.draft?.questions.every((item) => (item.correctIndexes?.length ?? 0) >= 1)).toBe(true);
    expect(result.reply).toMatch(/4 opciones/i);
  });

  it('pide cantidad si no hay tema ni lista', () => {
    const result = localQuizRespond(
      { messages: [{ role: 'user', content: 'Hola' }] },
      context,
    );
    expect(result.draft).toBeNull();
    expect(result.reply).toMatch(/cuántas/i);
  });
});
