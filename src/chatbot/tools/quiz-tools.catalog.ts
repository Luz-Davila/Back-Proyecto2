const questionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    statement: { type: 'string', minLength: 1, maxLength: 500 },
    correctBoolean: { type: 'boolean' },
  },
  required: ['statement', 'correctBoolean'],
};

export const QUIZ_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'getQuizContext',
      description:
        'Consulta el cuestionario abierto. Solo lectura; no acepta identificadores.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'proposeQuestions',
      description:
        'Prepara el borrador V/F completo para revisión humana. Al ampliar, incluye las preguntas retenidas y las nuevas, no solo el incremento. NO guarda preguntas.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: questionSchema,
          },
        },
        required: ['questions'],
      },
    },
  },
];
