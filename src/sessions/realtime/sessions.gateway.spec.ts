import type { Socket } from 'socket.io';
import { SessionsGateway } from './sessions.gateway';
import type { SessionSocketAuthService } from './session-socket-auth.service';
import type { SessionRealtimeService } from './session-realtime.service';
import type { SessionRealtimeHub } from './session-realtime.hub';
import type { SessionNotifications } from '../session-notifications';

describe('Dispatcher de acks', () => {
  it('no entrega un estado si el token vence después de admitir el comando', async () => {
    let handler!: (event: string, ...args: unknown[]) => void;
    const socket = {
      onAny: (callback: typeof handler) => {
        handler = callback;
      },
    } as unknown as Socket;
    const auth = {
      authenticated: jest.fn().mockResolvedValue({ secretState: true }),
      canSend: () => false,
    };
    const gateway = new SessionsGateway(
      auth as unknown as SessionSocketAuthService,
      {} as SessionRealtimeService,
      {} as SessionRealtimeHub,
      {} as SessionNotifications,
    );
    gateway.handleConnection(socket);
    const ack = jest.fn();
    handler('game:start', {}, ack);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });
  });

  it('no autentica ni ejecuta un mensaje sin callback', () => {
    let handler!: (event: string, ...args: unknown[]) => void;
    const socket = {
      onAny: (callback: typeof handler) => {
        handler = callback;
      },
    } as unknown as Socket;
    const authenticated = jest.fn();
    const gateway = new SessionsGateway(
      { authenticated } as unknown as SessionSocketAuthService,
      {} as SessionRealtimeService,
      {} as SessionRealtimeHub,
      {} as SessionNotifications,
    );
    gateway.handleConnection(socket);
    handler('game:start', {});
    expect(authenticated).not.toHaveBeenCalled();
  });
});
