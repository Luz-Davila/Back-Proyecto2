import type { SchemaObject } from '@nestjs/swagger';
import { SESSION_ERRORS } from './session.error';

const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const text: SchemaObject = { type: 'string' };
const integer: SchemaObject = { type: 'integer' };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const nullableDate: SchemaObject = { ...date, nullable: true };

function object(properties: Record<string, SchemaObject>): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export const PARTICIPANT_SCHEMA = object({
  id: uuid,
  sessionId: uuid,
  userId: uuid,
  displayName: text,
  joinedAt: date,
});
const questionFields = {
  id: uuid,
  position: integer,
  statement: text,
  kind: { type: 'string', enum: ['boolean', 'multiple'] },
  options: {
    type: 'array',
    nullable: true,
    items: { type: 'string' },
  } as SchemaObject,
  imageUrl: { type: 'string', nullable: true } as SchemaObject,
  openedAt: date,
  closesAt: date,
  closedAt: nullableDate,
  reviewEndsAt: nullableDate,
};

export const SESSION_STATE_SCHEMA = object({
  id: uuid,
  code: text,
  hostId: uuid,
  quizTitle: text,
  status: { type: 'string', enum: ['WAITING', 'IN_PROGRESS', 'FINISHED'] },
  phase: {
    type: 'string',
    enum: ['WAITING', 'ANSWERING', 'REVIEW', 'FINISHED'],
  },
  questionDurationSeconds: { type: 'integer', minimum: 5, maximum: 120 },
  currentIndex: integer,
  questionsCount: integer,
  startedAt: nullableDate,
  finishedAt: nullableDate,
  serverTime: date,
  participants: { type: 'array', items: PARTICIPANT_SCHEMA },
  currentQuestion: {
    nullable: true,
    oneOf: [
      object({ ...questionFields, status: { type: 'string', enum: ['OPEN'] } }),
      object({
        ...questionFields,
        status: { type: 'string', enum: ['CLOSED'] },
        correctBoolean: { type: 'boolean' },
        correctIndexes: { type: 'array', nullable: true, items: { type: 'integer' } },
      }),
    ],
  },
  results: {
    type: 'array',
    nullable: true,
    items: object({ participantId: uuid, totalScore: integer, rank: integer }),
  },
});

export const SESSION_HISTORY_ITEM_SCHEMA = object({
  id: uuid,
  code: text,
  quizTitle: text,
  finishedAt: date,
  participantCount: integer,
  questionsCount: integer,
  winnerDisplayName: { type: 'string', nullable: true },
  winnerScore: { type: 'integer', nullable: true },
  correctCount: integer,
  wrongCount: integer,
  unansweredCount: integer,
  ranking: {
    type: 'array',
    items: object({
      participantId: uuid,
      displayName: text,
      totalScore: integer,
      rank: integer,
    }),
  },
  questions: {
    type: 'array',
    items: object({
      position: integer,
      statement: text,
      kind: { type: 'string', enum: ['boolean', 'multiple'] },
      options: { type: 'array', nullable: true, items: { type: 'string' } },
      correctBoolean: { type: 'boolean' },
      correctIndexes: { type: 'array', nullable: true, items: { type: 'integer' } },
      correctCount: integer,
      wrongCount: integer,
      unansweredCount: integer,
      correctNames: { type: 'array', items: text },
      wrongNames: { type: 'array', items: text },
      unansweredNames: { type: 'array', items: text },
    }),
  },
});

export const PLAYED_SESSION_ITEM_SCHEMA = object({
  id: uuid,
  code: text,
  quizTitle: text,
  finishedAt: date,
  questionsCount: integer,
  participantCount: integer,
  rank: { type: 'integer', nullable: true },
  totalScore: integer,
  correctCount: integer,
  wrongCount: integer,
  unansweredCount: integer,
  winnerDisplayName: { type: 'string', nullable: true },
  questions: {
    type: 'array',
    items: object({
      position: integer,
      statement: text,
      kind: { type: 'string', enum: ['boolean', 'multiple'] },
      options: { type: 'array', nullable: true, items: { type: 'string' } },
      correctBoolean: { type: 'boolean' },
      correctIndexes: { type: 'array', nullable: true, items: { type: 'integer' } },
      myChoice: { nullable: true },
    }),
  },
});

export const JOIN_SESSION_SCHEMA = object({
  participant: PARTICIPANT_SCHEMA,
  session: SESSION_STATE_SCHEMA,
});
export const ROOM_ENVELOPE_SCHEMA = object({
  sessionId: uuid,
  streamId: text,
  sequence: { type: 'integer', minimum: 0 },
  serverTime: date,
  remainingMs: { type: 'integer', minimum: 0 },
  reviewDurationSeconds: { type: 'integer', minimum: 3, maximum: 15 },
  scoreboard: {
    type: 'array',
    items: object({ participantId: uuid, totalScore: integer, rank: integer }),
  },
  state: SESSION_STATE_SCHEMA,
});
export const SESSION_ERROR_SCHEMA = object({
  statusCode: integer,
  code: { type: 'string', enum: Object.keys(SESSION_ERRORS) },
  message: text,
});

export const SESSION_ERROR_CATALOG = Object.entries(SESSION_ERRORS)
  .map(
    ([code, definition]) =>
      `${code} (${definition.statusCode}): ${definition.message}`,
  )
  .join('\n\n');
