import {
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import {
  SessionNotifications,
  type CommittedSession,
  type SessionNotificationSink,
} from '../session-notifications';
import { SessionSocketAuthService } from './session-socket-auth.service';

@Injectable()
export class SessionRealtimeHub
  implements SessionNotificationSink, OnModuleDestroy
{
  private readonly subscriptions = new Map<
    Socket,
    { userId: string; sessions: Set<string> }
  >();

  constructor(
    private readonly auth: SessionSocketAuthService,
    private readonly notifications: SessionNotifications,
  ) {}

  async subscribe(socket: Socket, sessionId: string): Promise<void> {
    if (!this.auth.canSend(socket)) throw new UnauthorizedException();
    await socket.join(`session:${sessionId}`);
    if (!this.auth.canSend(socket)) throw new UnauthorizedException();
    let subscription = this.subscriptions.get(socket);
    if (!subscription) {
      subscription = {
        userId: this.auth.current(socket).user.id,
        sessions: new Set(),
      };
      this.subscriptions.set(socket, subscription);
    }
    subscription.sessions.add(sessionId);
  }

  forget(socket: Socket): void {
    this.subscriptions.delete(socket);
  }

  async changed(committed: CommittedSession): Promise<void> {
    const sessionId = committed.snapshot.session.id;
    // Revoke before projecting or sending: even a failed image signature must
    // not preserve access for a player who left via REST or another device.
    for (const [socket, subscription] of this.subscriptions) {
      if (committed.removedUserIds.includes(subscription.userId)) {
        subscription.sessions.delete(sessionId);
        await socket.leave(`session:${sessionId}`);
      }
    }
    const recipients = [...this.subscriptions]
      .filter(
        ([socket, sub]) =>
          sub.sessions.has(sessionId) && this.auth.canSend(socket),
      )
      .map(([socket]) => socket);
    if (!recipients.length) return;
    committed.notificationStage = 'projection';
    const envelope = await this.notifications.envelope(committed);
    committed.notificationStage = 'delivery';
    for (const socket of recipients) {
      if (!this.auth.canSend(socket)) continue;
      socket.emit('room:state', envelope);
      if (committed.event && committed.event !== 'game:finished')
        socket.emit(committed.event, envelope);
      if (committed.scoreboardUpdated)
        socket.emit('scoreboard:updated', envelope);
      if (committed.event === 'game:finished')
        socket.emit('game:finished', envelope);
    }
  }

  onModuleDestroy(): void {
    this.notifications.detach();
    this.subscriptions.clear();
  }
}
