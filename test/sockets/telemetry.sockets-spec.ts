import request from 'supertest';
import { UnauthorizedException } from '@nestjs/common';
import { Answer } from '../../src/sessions/answer.entity';
import { GAME_INSTRUMENTS } from '../../src/sessions/game-telemetry';
import { SessionRealtimeHub } from '../../src/sessions/realtime/session-realtime.hub';
import { SessionStateProjector } from '../../src/sessions/session-state.projector';
import {
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics';
import { gameMetrics } from '../support/game-metric-reader';
import {
  command,
  createSocketTestContext,
  type SocketTestContext,
} from '../support/socket-test-context';

describe('Telemetría de operaciones reales y rollbacks', () => {
  let ctx: SocketTestContext;
  let m: ReturnType<typeof gameMetrics>;
  beforeEach(async () => {
    m = gameMetrics();
    ctx = await createSocketTestContext({ telemetry: m.telemetry });
  });
  afterEach(async () => {
    await ctx?.close();
    await m.provider.shutdown();
  });
  async function room(count = 1) {
    const { owner, quiz } = await ctx.seedQuiz();
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 5,
    });
    const users = Array.from({ length: count }, () => ctx.user());
    const sockets = await Promise.all(users.map((user) => ctx.connect(user)));
    for (const socket of sockets)
      await command(socket, 'room:join', { code: state.code });
    await ctx.lifecycle.start({ sessionId: state.id, actorId: owner.id });
    const snapshot = await ctx.repository.read(state.id);
    return {
      owner,
      state,
      users,
      sockets,
      input: { sessionQuestionId: snapshot.questions[0].id, choice: true },
    };
  }

  it('accepted/replayed, altas y recuperación se cuentan una vez y sin etiquetas privadas', async () => {
    const r = await room();
    await command(r.sockets[0], 'answer:submit', r.input);
    await command(r.sockets[0], 'answer:submit', r.input);
    await command(r.sockets[0], 'answer:submit', r.input);
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    await command(r.sockets[0], 'room:join', { code: r.state.code });
    await request(ctx.app.getHttpServer())
      .get(`/sessions/${r.state.code}/state`)
      .set('Authorization', `Bearer ${await ctx.token(r.users[0])}`)
      .expect(200);
    await request(ctx.app.getHttpServer())
      .get(`/sessions/${r.state.code}/state`)
      .expect(401);
    await command(r.sockets[0], 'a-random-private-name', {});
    await command(r.sockets[0], 'answer:submit', {
      ...r.input,
      userId: r.users[0].id,
    });
    jest
      .spyOn(ctx.auth, 'verifySocketToken')
      .mockRejectedValueOnce(new UnauthorizedException());
    await command(r.sockets[0], 'room:subscribe', { sessionId: r.state.id });
    const points = await m.reader.points();
    expect(points.filter((p) => p.name === GAME_INSTRUMENTS.answers)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: { outcome: 'accepted', code: 'NONE' },
          value: 1,
        }),
        expect.objectContaining({
          attributes: { outcome: 'replayed', code: 'NONE' },
          value: 2,
        }),
      ]),
    );
    expect(points.filter((p) => p.name === GAME_INSTRUMENTS.recovery)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: {
            operation: 'room_join',
            outcome: 'created',
            code: 'NONE',
          },
          value: 1,
        }),
        expect.objectContaining({
          attributes: {
            operation: 'room_join',
            outcome: 'recovered',
            code: 'NONE',
          },
          value: 1,
        }),
        expect.objectContaining({
          attributes: {
            operation: 'state_by_code',
            outcome: 'rejected',
            code: 'UNAUTHORIZED',
          },
          value: 1,
        }),
      ]),
    );
    expect(points.filter((p) => p.name === GAME_INSTRUMENTS.commands)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: {
            command: 'room:subscribe',
            outcome: 'rejected',
            code: 'UNAUTHORIZED',
          },
          value: 1,
        }),
        expect.objectContaining({
          attributes: {
            command: 'unsupported',
            outcome: 'rejected',
            code: 'EVENT_NOT_SUPPORTED',
          },
          value: 1,
        }),
      ]),
    );
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    const exported = JSON.stringify(points);
    for (const secret of [
      r.state.id,
      r.state.code,
      r.users[0].id,
      'a-random-private-name',
      'answeredAt',
      'correctBoolean',
    ])
      expect(exported).not.toContain(secret);
  });

  it('rollback no cuenta accepted y un fallo posterior al commit no lo deshace', async () => {
    const r = await room();
    const persist = ctx.repository.persist.bind(ctx.repository);
    jest
      .spyOn(ctx.repository, 'persist')
      .mockImplementationOnce(async (manager, aggregate) => {
        await persist(manager, aggregate);
        throw new Error('rollback');
      });
    await command(r.sockets[0], 'answer:submit', r.input);
    expect(
      (await m.reader.points()).filter(
        (p) =>
          p.name === GAME_INSTRUMENTS.answers &&
          p.attributes.outcome === 'accepted',
      ),
    ).toEqual([]);
    jest
      .spyOn(ctx.app.get(SessionRealtimeHub), 'changed')
      .mockRejectedValueOnce(new Error('delivery'));
    await command(r.sockets[0], 'answer:submit', r.input);
    expect(
      (await m.reader.points()).find(
        (p) =>
          p.name === GAME_INSTRUMENTS.answers &&
          p.attributes.outcome === 'accepted',
      )?.value,
    ).toBe(1);
    expect(
      (await m.reader.points()).find(
        (p) => p.name === GAME_INSTRUMENTS.notificationFailures,
      ),
    ).toMatchObject({ attributes: { stage: 'delivery' }, value: 1 });
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    const next = await room();
    jest
      .spyOn(ctx.app.get(SessionStateProjector), 'project')
      .mockRejectedValueOnce(new Error('signature'));
    await command(next.sockets[0], 'answer:submit', next.input);
    expect(
      (await m.reader.points()).find(
        (p) =>
          p.name === GAME_INSTRUMENTS.notificationFailures &&
          p.attributes.stage === 'projection',
      ),
    ).toMatchObject({ value: 1 });
  });

  it('plazo atrasado y viejo no-op solo generan una observación efectiva', async () => {
    const r = await room(2);
    await command(r.sockets[0], 'answer:submit', r.input);
    const q = (await ctx.repository.read(r.state.id)).questions[0];
    ctx.clock.advance(6000);
    const job = {
      sessionId: r.state.id,
      expectedQuestionId: q.id,
      kind: 'ANSWER' as const,
      expectedDeadline: q.closesAt!,
    };
    await ctx.lifecycle.processDeadline(job);
    await ctx.lifecycle.processDeadline(job);
    expect(
      (await m.reader.points()).find(
        (p) => p.name === GAME_INSTRUMENTS.deadlineLag,
      ),
    ).toMatchObject({
      attributes: { kind: 'ANSWER' },
      value: { count: 1, sum: 1 },
    });
    expect(ctx.telemetry.connectionCount()).toBe(2);
  });

  it('exportador bloqueado/fallido no bloquea comandos ni revierte el juego', async () => {
    await ctx.close();
    await m.provider.shutdown();
    let entered!: () => void;
    const exporting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    let blocked = true;
    const exporter: PushMetricExporter = {
      export(_metrics, callback) {
        if (blocked) {
          entered();
          release = () => {
            blocked = false;
            callback({ code: 1 });
          };
        } else callback({ code: 1 });
      },
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60000,
      exportTimeoutMillis: 5000,
    });
    m = gameMetrics([reader]);
    ctx = await createSocketTestContext({ telemetry: m.telemetry });
    const r = await room();
    const flushing = m.provider.forceFlush().catch(() => undefined);
    await exporting;
    try {
      expect(
        await command(r.sockets[0], 'answer:submit', r.input),
      ).toMatchObject({ ok: true });
      expect((await ctx.repository.read(r.state.id)).questions[0].status).toBe(
        'CLOSED',
      );
      expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    } finally {
      release();
      await flushing;
    }
  });
});
