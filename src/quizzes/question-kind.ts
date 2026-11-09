import { BadRequestException } from '@nestjs/common';

export const QUESTION_KINDS = ['boolean', 'multiple'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const MULTIPLE_OPTION_COUNT = 4;
export const OPTION_MAX_LENGTH = 80;

export interface QuestionContent {
  kind: QuestionKind;
  correctBoolean: boolean;
  options: string[] | null;
  correctIndexes: number[] | null;
}

export function parseQuestionKind(value: unknown): QuestionKind | undefined {
  return value === 'boolean' || value === 'multiple' ? value : undefined;
}

export function normalizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== MULTIPLE_OPTION_COUNT) {
    throw new BadRequestException('Las preguntas de opción múltiple llevan 4 respuestas');
  }
  const options = raw.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (options.some((item) => !item || item.length > OPTION_MAX_LENGTH)) {
    throw new BadRequestException(
      `Cada opción debe tener entre 1 y ${OPTION_MAX_LENGTH} caracteres`,
    );
  }
  return options;
}

export function normalizeCorrectIndexes(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException('Marca al menos una opción correcta');
  }
  const unique = [
    ...new Set(
      raw.filter((item): item is number => Number.isInteger(item) && item >= 0 && item <= 3),
    ),
  ].sort((a, b) => a - b);
  if (unique.length === 0) {
    throw new BadRequestException('Marca al menos una opción correcta');
  }
  return unique;
}

export function resolveCreateQuestion(dto: {
  kind?: unknown;
  correctBoolean?: unknown;
  options?: unknown;
  correctIndexes?: unknown;
}): QuestionContent {
  const kind = parseQuestionKind(dto.kind) ?? 'boolean';
  if (kind === 'multiple') {
    return {
      kind: 'multiple',
      correctBoolean: false,
      options: normalizeOptions(dto.options),
      correctIndexes: normalizeCorrectIndexes(dto.correctIndexes),
    };
  }
  if (typeof dto.correctBoolean !== 'boolean') {
    throw new BadRequestException('correctBoolean must be a boolean value');
  }
  return {
    kind: 'boolean',
    correctBoolean: dto.correctBoolean,
    options: null,
    correctIndexes: null,
  };
}

export function isCorrectAnswer(
  question: {
    kind?: string | null;
    correctBoolean: boolean;
    correctIndexes?: number[] | null;
  },
  answer: { choice?: boolean | null; choiceIndex?: number | null },
): boolean {
  if ((question.kind ?? 'boolean') === 'multiple') {
    return (
      typeof answer.choiceIndex === 'number' &&
      (question.correctIndexes ?? []).includes(answer.choiceIndex)
    );
  }
  return answer.choice === question.correctBoolean;
}
