import request from 'supertest';
import { Question } from '../../src/quizzes/question.entity';
import { SessionNotifications } from '../../src/sessions/session-notifications';
import { SessionDeadlinesService } from '../../src/sessions/session-deadlines.service';
import { SessionRealtimeHub } from '../../src/sessions/realtime/session-realtime.hub';
import type {
  SessionAck,
  RealtimeJoinResult,
} from '../../src/sessions/realtime/session-realtime.contracts';
import {
  command,
  collect,
  createSocketTestContext,
  type SocketTestContext,
} from '../support/socket-test-context';

function data<T>(ack: SessionAck<T>): T {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error(ack.error.code);
  return ack.data;
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

describe('Socket.IO: renovación, orígenes y recuperación', () => {
  let ctx: SocketTestContext;
  const originalOrigin = process.env.CORS_ORIGIN;
  beforeAll(async () => {
    process.env.CORS_ORIGIN = 'https://allowed.example.test';
    ctx = await createSocketTestContext();
  });
  beforeEach(async () => {
    await ctx.closeSockets();
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx?.close();
    if (originalOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalOrigin;
  });

  async function seed() {
    const { owner, quiz } = await ctx.seedQuiz();
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 15,
    });
    const player = ctx.user();
    await ctx.rooms.join(player, state.code);
    return { owner, state, player };
  }

  it('renueva durante la partida sin perder conexión ni suscripción', async () => {
    const r = await seed();
    const expiresAt = Math.floor(Date.now() / 1000) + 10;
    const socket = await ctx.connect(
      r.player,
      await ctx.token(r.player, expiresAt),
    );
    data(await command(socket, 'room:subscribe', { sessionId: r.state.id }));
    const id = socket.id;
    data(
      await command(socket, 'auth:refresh', {
        token: await ctx.token(r.player),
      }),
    );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, expiresAt * 1000 - Date.now() + 100)),
    );
    expect(socket.connected).toBe(true);
    expect(socket.id).toBe(id);
    const events = collect(socket);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    await flush();
    expect(events.at(-1)!.event).toBe('question:opened');
    expect(events.at(-1)!.room.sessionId).toBe(r.state.id);
    expect(
      await command(socket, 'auth:refresh', { token: 'invalid' }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(
      await command(socket, 'auth:refresh', {
        token: await ctx.token(ctx.user()),
      }),
    ).toMatchObject({ ok: false, error: { code: 'UNAUTHORIZED' } });
    expect(socket.connected).toBe(true);
  }, 60_000);

  it('vence sin actividad, no recibe eventos posteriores y reconecta con el mismo participante', async () => {
    const r = await seed();
    const socket = await ctx.connect(
      r.player,
      await ctx.token(r.player, Math.floor(Date.now() / 1000) + 2),
    );
    data(await command(socket, 'room:subscribe', { sessionId: r.state.id }));
    const events = collect(socket);
    await new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    expect(events).toEqual([]);
    const second = await ctx.connect(r.player);
    const recovered = data(
      await command<RealtimeJoinResult>(second, 'room:join', {
        code: r.state.code,
      }),
    );
    expect(recovered.room.state.phase).toBe('ANSWERING');
    expect(recovered.room.state.participants).toHaveLength(1);
  });

  it.each(['websocket', 'polling'] as const)(
    'controla Origin en %s sin sustituir JWT',
    async (transport) => {
      const token = await ctx.token(ctx.user());
      const blocked = ctx.client(token, {
        origin: 'https://blocked.example.test',
        transport,
      });
      await new Promise<void>((resolve) => {
        blocked.once('connect_error', () => resolve());
        blocked.connect();
      });
      expect(blocked.connected).toBe(false);
      const allowed = ctx.client(token, {
        origin: 'https://allowed.example.test',
        transport,
      });
      await new Promise<void>((resolve, reject) => {
        allowed.once('connect', resolve);
        allowed.once('connect_error', reject);
        allowed.connect();
      });
      expect(allowed.connected).toBe(true);
      const noToken = ctx.client(undefined, {
        origin: 'https://allowed.example.test',
        transport,
      });
      const error = await new Promise<{ data?: { code: string } }>(
        (resolve) => {
          noToken.once('connect_error', resolve);
          noToken.connect();
        },
      );
      expect(error.data?.code).toBe('UNAUTHORIZED');
    },
  );

  it('salida REST concurrente con suscripción no conserva acceso residual', async () => {
    const r = await seed();
    const socket = await ctx.connect(r.player);
    const token = await ctx.token(r.player);
    await Promise.all([
      command(socket, 'room:subscribe', { sessionId: r.state.id }),
      request(ctx.app.getHttpServer())
        .delete(`/sessions/${r.state.id}/participants/me`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204),
    ]);
    const events = collect(socket);
    await ctx.rooms.join(ctx.user(), r.state.code);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    await flush();
    expect(events).toEqual([]);
    expect(
      await command(socket, 'room:subscribe', { sessionId: r.state.id }),
    ).toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } });
  });

  it('fallo de firma posterior al commit no filtra snapshots y permite recuperar', async () => {
    const { owner, quiz } = await ctx.seedQuiz();
    await ctx.dataSource
      .getRepository(Question)
      .update({ quizId: quiz.id, position: 0 }, { imageKey: 'private.png' });
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 15,
    });
    const player = ctx.user();
    await ctx.rooms.join(player, state.code);
    const socket = await ctx.connect(player);
    const host = await ctx.connect(owner);
    data(await command(socket, 'room:subscribe', { sessionId: state.id }));
    const events = collect(socket);
    ctx.storage.signedUrl.mockRejectedValueOnce(
      new Error('secret storage error'),
    );
    const response = await command(host, 'game:start', { sessionId: state.id });
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    expect(JSON.stringify(response)).not.toMatch(
      /secret|imageKey|correctBoolean/,
    );
    expect(events).toEqual([]);
    const recovered = data(
      await command(socket, 'room:subscribe', { sessionId: state.id }),
    );
    expect(recovered.state.status).toBe('IN_PROGRESS');
    expect(recovered.state.currentQuestion).not.toHaveProperty(
      'correctBoolean',
    );
  });

  it('reinicia generación del stream y recupera plazos persistidos sin replay', async () => {
    const r = await seed();
    const socket = await ctx.connect(r.player);
    data(await command(socket, 'room:subscribe', { sessionId: r.state.id }));
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    const before = data(
      await command(socket, 'room:subscribe', { sessionId: r.state.id }),
    );
    socket.disconnect();
    // Simulate replacement of the volatile stream registry/worker while keeping
    // the same PostgreSQL data. Boot clears this registry in a new process too.
    const notifications = ctx.app.get(SessionNotifications);
    notifications.onModuleDestroy();
    notifications.attach(ctx.app.get(SessionRealtimeHub));
    ctx.clock.advance(90_000);
    const worker = new SessionDeadlinesService(
      ctx.repository,
      ctx.lifecycle,
      ctx.clock,
    );
    await worker.onModuleInit();
    await worker.onModuleDestroy();
    const second = await ctx.connect(r.player);
    const events = collect(second);
    const recovered = data(
      await command(second, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(recovered.streamId).not.toBe(before.streamId);
    expect(recovered.state.currentIndex).toBe(1);
    expect(recovered.remainingMs).toBe(15_000);
    expect(events).toEqual([]);
  });
});
