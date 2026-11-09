import type { QuestionDraftDto } from '../../quizzes/dto/question-draft.dto';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface QuizContext {
  title: string;
  description: string | null;
  questionsCount: number;
  truncated: boolean;
  questions: {
    statement: string;
    kind: 'boolean' | 'multiple';
    correctBoolean: boolean;
    options: string[] | null;
    correctIndexes: number[] | null;
  }[];
}

export interface ChatResponse {
  reply: string;
  draft: QuestionDraftDto | null;
}
