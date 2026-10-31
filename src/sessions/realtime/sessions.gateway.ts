import { Logger, UnauthorizedException, Optional } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import { GameTelemetry } from '../game-telemetry';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { IncomingMessage } from 'http';
import { SessionNotifications } from '../session-notifications';
import {
  SESSION_NAMESPACE,
  SESSION_SOCKET_PATH,
  type AckCallback,
} from './session-realtime.contracts';
import {
  SessionRealtimeService,
  sessionSocketError,
} from './session-realtime.service';
import { SessionRealtimeHub } from './session-realtime.hub';
import { SessionSocketAuthService } from './session-socket-auth.service';

function allowedOrigin(origin: string | undefined): boolean {
  return (
    !origin ||
    (process.env.CORS_ORIGIN ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .includes(origin)
  );
}

@WebSocketGateway({
  namespace: SESSION_NAMESPACE,
  path: SESSION_SOCKET_PATH,
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => callback(null, allowedOrigin(origin)),
  },
  allowRequest: (
    request: IncomingMessage,
    callback: (error: string | null | undefined, success: boolean) => void,
  ) => callback(null, allowedOrigin(request.headers.origin)),
})
export class SessionsGateway
  implements
    OnGatewayInit<Namespace>,
    OnGatewayConnection<Socket>,
    OnGatewayDisconnect<Socket>
{
  private readonly logger = new Logger(SessionsGateway.name);

  constructor(
    private readonly auth: SessionSocketAuthService,
    private readonly application: SessionRealtimeService,
    private readonly hub: SessionRealtimeHub,
    private readonly notifications: SessionNotifications,
    @Optional() private readonly telemetry?: GameTelemetry,
  ) {}

  afterInit(namespace: Namespace): void {
    this.notifications.attach(this.hub);
    namespace.use((socket, next) => {
      void this.auth.connect(socket).then(
        () => next(),
        (error: unknown) => {
          const failure = Object.assign(new Error('No autorizado'), {
            data: sessionSocketError(error),
          });
          next(failure);
        },
      );
    });
  }

  handleConnection(socket: Socket): void {
    this.telemetry?.connected(socket, () => this.auth.canSend(socket));
    // Explicit packet dispatcher: one path owns validation/auth errors and acks,
    // including unsupported event names. No Nest exception event side-channel.
    socket.onAny((event: string, ...args: unknown[]) => {
      const last = args.at(-1);
      if (typeof last !== 'function') return;
      const callback = last as AckCallback;
      const started = performance.now();
      const observation: { created?: boolean } = {};
      let acknowledged = false;
      const ack: AckCallback = (response) => {
        if (acknowledged) return;
        acknowledged = true;
        this.telemetry?.command(event, response, started, observation.created);
        callback(response);
      };
      const payload = args.length === 2 ? args[0] : undefined;
      void this.auth
        .authenticated(socket, (user) =>
          this.application.dispatch(socket, event, payload, user, observation),
        )
        .then((data) => {
          if (this.auth.canSend(socket)) ack({ ok: true, data });
          else
            ack({
              ok: false,
              error: sessionSocketError(new UnauthorizedException()),
            });
        })
        .catch((error: unknown) => {
          const failure = sessionSocketError(error);
          if (failure.code === 'INTERNAL_ERROR')
            this.logger.error(
              'Falló un comando de sesiones; consultar el estado antes de reintentar',
            );
          ack({ ok: false, error: failure });
        });
    });
  }

  handleDisconnect(socket: Socket): void {
    this.telemetry?.disconnected(socket);
    this.auth.forget(socket);
    this.hub.forget(socket);
  }
}
