import type { SessionStatus } from './game-session.entity';

export const MIN_QUESTION_DURATION_SECONDS = 5;
export const MAX_QUESTION_DURATION_SECONDS = 120;
export const DEFAULT_QUESTION_DURATION_SECONDS = 30;
export const MIN_REVIEW_DURATION_SECONDS = 3;
export const MAX_REVIEW_DURATION_SECONDS = 15;
export const DEFAULT_REVIEW_DURATION_SECONDS = 5;
export const SPEED_BONUS_WINDOW_MS = 3_000;
export type QuestionDurationSeconds = number;
export const SESSION_PHASES = [
  'WAITING',
  'ANSWERING',
  'REVIEW',
  'FINISHED',
] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

export interface CreateSessionInput {
  quizId: string;
  questionDurationSeconds?: QuestionDurationSeconds;
  reviewDurationSeconds?: number;
}

export interface SubmitAnswerInput {
  sessionQuestionId: string;
  choice: boolean;
}

export interface AnswerReceipt extends SubmitAnswerInput {
  id: string;
  answeredAt: string;
}

export interface HostSessionCommand {
  actorId: string;
  sessionId: string;
}

export type StartSessionCommand = HostSessionCommand;
export type FinishSessionCommand = HostSessionCommand;

export interface AdvanceSessionCommand extends HostSessionCommand {
  expectedQuestionId: string;
}

/** Uso interno: no representa un contrato público de envío de respuestas. */
export interface EvaluateAcceptedAnswersCommand {
  sessionId: string;
  expectedQuestionId: string;
}

export interface ProcessSessionDeadlineCommand extends EvaluateAcceptedAnswersCommand {
  kind: 'ANSWER' | 'REVIEW';
  expectedDeadline: Date;
}

export interface ParticipantView {
  id: string;
  sessionId: string;
  userId: string;
  displayName: string;
  joinedAt: string;
}

interface CurrentQuestionFields {
  id: string;
  position: number;
  statement: string;
  imageUrl: string | null;
  openedAt: string;
  closesAt: string;
  closedAt: string | null;
  reviewEndsAt: string | null;
}

export type CurrentQuestionView = CurrentQuestionFields &
  ({ status: 'OPEN' } | { status: 'CLOSED'; correctBoolean: boolean });

export interface SessionResultView {
  participantId: string;
  totalScore: number;
  rank: number;
}

export interface SessionState {
  id: string;
  code: string;
  hostId: string;
  quizTitle: string;
  status: SessionStatus;
  phase: SessionPhase;
  questionDurationSeconds: QuestionDurationSeconds;
  currentIndex: number;
  questionsCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  serverTime: string;
  participants: ParticipantView[];
  currentQuestion: CurrentQuestionView | null;
  results: SessionResultView[] | null;
}

export interface JoinSessionResult {
  participant: ParticipantView;
  session: SessionState;
}

export const SESSION_HISTORY_LIMIT = 50;

export interface SessionHistoryRankingRow {
  participantId: string;
  displayName: string;
  totalScore: number;
  rank: number;
}

export interface SessionHistoryQuestionStat {
  position: number;
  statement: string;
  correctBoolean: boolean;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  correctNames: string[];
  wrongNames: string[];
  unansweredNames: string[];
}

export interface PlayedQuestion {
  position: number;
  statement: string;
  correctBoolean: boolean;
  myChoice: boolean | null;
}

/** Partida finalizada en la que el usuario autenticado participó. */
export interface PlayedSessionItem {
  id: string;
  code: string;
  quizTitle: string;
  finishedAt: string;
  questionsCount: number;
  participantCount: number;
  rank: number | null;
  totalScore: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  winnerDisplayName: string | null;
  questions: PlayedQuestion[];
}

/** Resumen de una partida finalizada para el anfitrión. */
export interface SessionHistoryItem {
  id: string;
  code: string;
  quizTitle: string;
  finishedAt: string;
  participantCount: number;
  questionsCount: number;
  winnerDisplayName: string | null;
  winnerScore: number | null;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  ranking: SessionHistoryRankingRow[];
  questions: SessionHistoryQuestionStat[];
}
