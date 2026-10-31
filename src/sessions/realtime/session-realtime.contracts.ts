import type {
  SessionState,
  ParticipantView,
  SessionResultView,
} from '../session.contracts';

export const SESSION_NAMESPACE = '/sessions';
export const SESSION_SOCKET_PATH = '/socket.io';
export const SESSION_COMMANDS = [
  'auth:refresh',
  'room:join',
  'room:subscribe',
  'room:leave',
  'game:start',
  'game:advance',
  'game:finish',
  'answer:submit',
] as const;
export type SessionCommand = (typeof SESSION_COMMANDS)[number];
export const SESSION_EVENTS = [
  'room:state',
  'question:opened',
  'question:closed',
  'game:finished',
  'scoreboard:updated',
] as const;
export type SessionEvent = (typeof SESSION_EVENTS)[number];

export interface StreamPosition {
  streamId: string;
  sequence: number;
}
export interface RoomEnvelope extends StreamPosition {
  sessionId: string;
  serverTime: string;
  remainingMs: number;
  reviewDurationSeconds: number;
  scoreboard: SessionResultView[];
  state: SessionState;
}
export interface RealtimeJoinResult {
  participant: ParticipantView;
  room: RoomEnvelope;
}
export type SessionAck<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
export type AckCallback = (response: SessionAck) => void;
