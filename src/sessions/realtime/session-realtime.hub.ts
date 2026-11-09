import {
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
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
  private nsp?: Namespace;

  constructor(
    private readonly auth: SessionSocketAuthService,
    private readonly notifications: SessionNotifications,
  ) {}

  bind(namespace: Namespace): void {
    this.nsp = namespace;
  }

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
    const room = `session:${sessionId}`;
    if (!this.nsp && !recipients.length) return;
    committed.notificationStage = 'projection';
    const envelope = await this.notifications.envelope(committed);
    committed.notificationStage = 'delivery';
    const emit = (event: string) => {
      if (this.nsp) {
        this.nsp.to(room).emit(event, envelope);
        return;
      }
      for (const socket of recipients) {
        if (!this.auth.canSend(socket)) continue;
        socket.emit(event, envelope);
      }
    };
    emit('room:state');
    if (committed.event && committed.event !== 'game:finished')
      emit(committed.event);
    if (committed.scoreboardUpdated) emit('scoreboard:updated');
    if (committed.event === 'game:finished') emit('game:finished');
  }

  onModuleDestroy(): void {
    this.notifications.detach();
    this.subscriptions.clear();
    this.nsp = undefined;
  }
}
