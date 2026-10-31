import { Injectable, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Socket } from 'socket.io';
import type { AuthenticatedUser } from '../../auth/auth.service';
import { SessionLifecycleService } from '../session-lifecycle.service';
import { SessionNotifications } from '../session-notifications';
import { SessionRoomsService } from '../session-rooms.service';
import { SessionError, SESSION_ERRORS } from '../session.error';
import {
  AdvanceCommandDto,
  JoinCommandDto,
  RefreshCommandDto,
  SessionIdCommandDto,
  SubmitAnswerCommandDto,
} from './session-command.dto';
import type {
  RoomEnvelope,
  RealtimeJoinResult,
} from './session-realtime.contracts';
import { SessionRealtimeHub } from './session-realtime.hub';
import { SessionSocketAuthService } from './session-socket-auth.service';
import { SessionAnswersService } from '../session-answers.service';

export class UnsupportedSessionEvent extends Error {}
export interface SessionCommandObservation {
  created?: boolean;
}

export function sessionSocketError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof SessionError)
    return { code: error.code, message: error.message };
  if (error instanceof UnauthorizedException)
    return {
      code: 'UNAUTHORIZED',
      message: SESSION_ERRORS.UNAUTHORIZED.message,
    };
  if (error instanceof UnsupportedSessionEvent)
    return { code: 'EVENT_NOT_SUPPORTED', message: 'Evento no disponible' };
  return {
    code: 'INTERNAL_ERROR',
    message: SESSION_ERRORS.INTERNAL_ERROR.message,
  };
}

@Injectable()
export class SessionRealtimeService {
  constructor(
    private readonly rooms: SessionRoomsService,
    private readonly lifecycle: SessionLifecycleService,
    private readonly notifications: SessionNotifications,
    private readonly hub: SessionRealtimeHub,
    private readonly auth: SessionSocketAuthService,
    private readonly answers: SessionAnswersService,
  ) {}

  async dispatch(
    socket: Socket,
    event: string,
    payload: unknown,
    user: AuthenticatedUser,
    observation: SessionCommandObservation = {},
  ): Promise<unknown> {
    switch (event) {
      case 'answer:submit': {
        const dto = await this.dto(SubmitAnswerCommandDto, payload);
        return { answer: await this.answers.submit(user, dto) };
      }
      case 'auth:refresh': {
        const dto = await this.dto(RefreshCommandDto, payload);
        return this.auth.refresh(socket, dto.token);
      }
      case 'room:join': {
        const dto = await this.dto(JoinCommandDto, payload);
        let result!: RealtimeJoinResult;
        await this.rooms.join(
          user,
          dto.code,
          async (participant, committed, created) => {
            observation.created = created;
            const room = await this.notifications.envelope(committed);
            await this.hub.subscribe(socket, room.sessionId);
            const view = room.state.participants.find(
              (p) => p.id === participant.id,
            )!;
            result = { participant: view, room };
          },
        );
        return result;
      }
      case 'room:subscribe': {
        const dto = await this.dto(SessionIdCommandDto, payload);
        let result!: RoomEnvelope;
        await this.rooms.observe(user, dto.sessionId, async (committed) => {
          result = await this.notifications.envelope(committed);
          await this.hub.subscribe(socket, dto.sessionId);
        });
        return result;
      }
      case 'room:leave': {
        const dto = await this.dto(SessionIdCommandDto, payload);
        await this.rooms.leave(user, dto.sessionId);
        return { sessionId: dto.sessionId };
      }
      case 'game:start':
      case 'game:finish': {
        const dto = await this.dto(SessionIdCommandDto, payload);
        const command = { sessionId: dto.sessionId, actorId: user.id };
        const committed =
          event === 'game:start'
            ? await this.lifecycle.start(command)
            : await this.lifecycle.finish(command);
        return this.notifications.envelope(committed);
      }
      case 'game:advance': {
        const dto = await this.dto(AdvanceCommandDto, payload);
        return this.notifications.envelope(
          await this.lifecycle.advance({ ...dto, actorId: user.id }),
        );
      }
      default:
        throw new UnsupportedSessionEvent();
    }
  }

  private async dto<T extends object>(
    type: new () => T,
    payload: unknown,
  ): Promise<T> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new SessionError('VALIDATION_ERROR');
    const dto = plainToInstance(type, payload);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length) throw new SessionError('VALIDATION_ERROR');
    return dto;
  }
}
