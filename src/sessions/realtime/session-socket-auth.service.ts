import {
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import { AuthService, type AuthenticatedUser } from '../../auth/auth.service';

interface SocketAccess {
  token: string;
  user: AuthenticatedUser;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
  generation: number;
}

@Injectable()
export class SessionSocketAuthService implements OnModuleDestroy {
  private readonly access = new Map<Socket, SocketAccess>();
  private readonly pending = new Map<Socket, Promise<void>>();

  constructor(private readonly auth: AuthService) {}

  async connect(socket: Socket): Promise<void> {
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) throw new UnauthorizedException();
    const verified = await this.auth.verifySocketToken(token);
    if (socket.conn?.readyState === 'closed') throw new UnauthorizedException();
    this.install(socket, { token, ...verified, generation: 1 });
    socket.conn?.once('close', () => this.forget(socket));
  }

  current(socket: Socket): SocketAccess {
    const access = this.access.get(socket);
    if (!access || access.expiresAt <= Date.now()) {
      socket.disconnect(true);
      throw new UnauthorizedException();
    }
    return access;
  }

  canSend(socket: Socket): boolean {
    if (!socket.connected) return false;
    try {
      this.current(socket);
      return true;
    } catch {
      return false;
    }
  }

  // Serialize verification/refresh without serializing database operations on
  // different rooms. A refresh cannot race another credential replacement.
  async authenticated<T>(
    socket: Socket,
    work: (user: AuthenticatedUser) => Promise<T>,
  ): Promise<T> {
    const previous = this.pending.get(socket) ?? Promise.resolve();
    let release!: () => void;
    const barrier = new Promise<void>((done) => {
      release = done;
    });
    this.pending.set(socket, barrier);
    await previous;
    try {
      const access = this.current(socket);
      const verified = await this.auth.verifySocketToken(access.token);
      this.current(socket);
      if (verified.user.id !== access.user.id)
        throw new UnauthorizedException();
      return await work(verified.user);
    } finally {
      release();
      if (this.pending.get(socket) === barrier) this.pending.delete(socket);
    }
  }

  async refresh(
    socket: Socket,
    token: string,
  ): Promise<{ userId: string; expiresAt: string }> {
    const old = this.current(socket);
    const verified = await this.auth.verifySocketToken(token);
    if (this.current(socket) !== old || verified.user.id !== old.user.id) {
      throw new UnauthorizedException();
    }
    this.install(socket, {
      token,
      ...verified,
      generation: old.generation + 1,
    });
    return {
      userId: verified.user.id,
      expiresAt: new Date(verified.expiresAt).toISOString(),
    };
  }

  forget(socket: Socket): void {
    const access = this.access.get(socket);
    if (access?.timer) clearTimeout(access.timer);
    this.access.delete(socket);
  }

  onModuleDestroy(): void {
    for (const socket of this.access.keys()) {
      this.forget(socket);
      socket.disconnect(true);
    }
  }

  private install(socket: Socket, access: SocketAccess): void {
    this.forget(socket);
    this.access.set(socket, access);
    const expire = () => {
      if (this.access.get(socket) !== access) return;
      const remaining = access.expiresAt - Date.now();
      if (remaining > 0) {
        access.timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      } else {
        this.forget(socket);
        socket.disconnect(true);
      }
    };
    expire();
  }
}
