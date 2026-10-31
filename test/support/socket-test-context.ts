import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { io, type Socket } from 'socket.io-client';
import {
  AuthService,
  type AuthenticatedUser,
} from '../../src/auth/auth.service';
import type {
  SessionAck,
  RoomEnvelope,
} from '../../src/sessions/realtime/session-realtime.contracts';
import { SESSION_EVENTS } from '../../src/sessions/realtime/session-realtime.contracts';
import { createSessionTestContext } from './session-test-context';
import type { GameTelemetry } from '../../src/sessions/game-telemetry';

export async function createSocketTestContext(
  configuration: { telemetry?: GameTelemetry } = {},
) {
  const pair = await generateKeyPair('ES256');
  const jwk = await exportJWK(pair.publicKey);
  const keys = createLocalJWKSet({
    keys: [{ ...jwk, kid: 'socket-test', alg: 'ES256' }],
  });
  const issuer = 'https://socket-tests.example.test/auth/v1';
  const auth = new AuthService(keys, issuer);
  const ctx = await createSessionTestContext({
    auth,
    telemetry: configuration.telemetry,
  });
  await ctx.app.listen(0, '127.0.0.1');
  const url: string = await ctx.app.getUrl();
  const sockets = new Set<Socket>();

  async function token(
    user: AuthenticatedUser,
    expiresAt = Math.floor(Date.now() / 1000) + 3600,
  ): Promise<string> {
    return new SignJWT({ user_metadata: { display_name: user.displayName } })
      .setProtectedHeader({ alg: 'ES256', kid: 'socket-test' })
      .setSubject(user.id)
      .setIssuer(issuer)
      .setAudience('authenticated')
      .setExpirationTime(expiresAt)
      .sign(pair.privateKey);
  }

  function client(
    accessToken?: string,
    options: {
      origin?: string;
      transport?: 'polling' | 'websocket';
      queryToken?: string;
    } = {},
  ) {
    const socket = io(`${url}/sessions`, {
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      auth: accessToken ? { token: accessToken } : {},
      transports: [options.transport ?? 'websocket'],
      extraHeaders: options.origin ? { Origin: options.origin } : {},
      query: options.queryToken ? { token: options.queryToken } : {},
    });
    sockets.add(socket);
    return socket;
  }

  async function connect(user: AuthenticatedUser, accessToken?: string) {
    const socket = client(accessToken ?? (await token(user)));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
    return socket;
  }

  return {
    ...ctx,
    auth,
    token,
    client,
    connect,
    async closeSockets() {
      for (const socket of sockets) {
        socket.disconnect();
        socket.removeAllListeners();
      }
      sockets.clear();
      // Wait for the server to observe disconnect before truncating fixtures.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    },
    async close() {
      for (const socket of sockets) socket.disconnect();
      await ctx.close();
    },
  };
}

export function command<T = RoomEnvelope>(
  socket: Socket,
  event: string,
  payload: unknown,
): Promise<SessionAck<T>> {
  return socket.timeout(10_000).emitWithAck(event, payload) as Promise<
    SessionAck<T>
  >;
}

export function collect(socket: Socket) {
  const events: Array<{ event: string; room: RoomEnvelope }> = [];
  for (const event of SESSION_EVENTS)
    socket.on(event, (room: RoomEnvelope) => events.push({ event, room }));
  return events;
}

export type SocketTestContext = Awaited<
  ReturnType<typeof createSocketTestContext>
>;
