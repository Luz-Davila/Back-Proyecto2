import { randomUUID } from 'crypto';
import request from 'supertest';
import { Answer } from '../../src/sessions/answer.entity';
import { Question } from '../../src/quizzes/question.entity';
import { Quiz } from '../../src/quizzes/quiz.entity';
import { ActiveSessionMembership } from '../../src/sessions/active-session-membership.entity';
import { SessionRealtimeHub } from '../../src/sessions/realtime/session-realtime.hub';
import { SessionStateProjector } from '../../src/sessions/session-state.projector';
import type {
  RealtimeJoinResult,
  SessionAck,
} from '../../src/sessions/realtime/session-realtime.contracts';
import {
  collect,
  command,
  createSocketTestContext,
  type SocketTestContext,
} from '../support/socket-test-context';

function data<T>(ack: SessionAck<T>): T {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error(ack.error.code);
  return ack.data;
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

describe('Gateway real: salas, permisos y preguntas seguras', () => {
  let ctx: SocketTestContext;
  beforeAll(async () => {
    ctx = await createSocketTestContext();
  });
  beforeEach(async () => {
    await ctx.closeSockets();
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx?.close();
  });

  async function room(duration: 15 | 30 = 15, questions = 2) {
    const { owner, quiz } = await ctx.seedQuiz(questions);
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: duration,
    });
    const host = await ctx.connect(owner);
    const hostEvents = collect(host);
    data(await command(host, 'room:subscribe', { sessionId: state.id }));
    const player = ctx.user();
    const socket = await ctx.connect(player);
    const events = collect(socket);
    const joined = data(
      await command<RealtimeJoinResult>(socket, 'room:join', {
        code: ` ${state.code.toLowerCase()} `,
      }),
    );
    return {
      owner,
      quiz,
      state,
      host,
      hostEvents,
      player,
      socket,
      events,
      joined,
    };
  }

  it.each([undefined, 'invalid-jwt'])(
    'rechaza handshake sin JWT válido: %s',
    async (token) => {
      const socket = ctx.client(token);
      const error = new Promise<{ data?: { code: string } }>((resolve) =>
        socket.once('connect_error', resolve),
      );
      socket.connect();
      expect((await error).data?.code).toBe('UNAUTHORIZED');
      expect(socket.connected).toBe(false);
    },
  );

  it('rechaza credenciales por query y JWT vencido', async () => {
    const user = ctx.user();
    for (const socket of [
      ctx.client(undefined, { queryToken: await ctx.token(user) }),
      ctx.client(await ctx.token(user, 1)),
    ]) {
      const error = new Promise<{ data?: { code: string } }>((resolve) =>
        socket.once('connect_error', resolve),
      );
      socket.connect();
      expect((await error).data?.code).toBe('UNAUTHORIZED');
    }
  });

  it('varios dispositivos mantienen participante único y desconectar no es salir', async () => {
    const r = await room();
    const second = await ctx.connect(r.player);
    const joined = data(
      await command<RealtimeJoinResult>(second, 'room:join', {
        code: r.state.code,
      }),
    );
    expect(joined.participant).toEqual(r.joined.participant);
    const events = collect(second);
    r.socket.disconnect();
    await flush();
    expect(
      (await ctx.rooms.state(r.owner, r.state.id)).participants,
    ).toHaveLength(1);
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(1);
    data(await command(r.host, 'game:start', { sessionId: r.state.id }));
    await flush();
    expect(events.some((event) => event.event === 'question:opened')).toBe(
      true,
    );
  });

  it('rechaza suscripción ajena y conserva las restricciones de incorporación', async () => {
    const r = await room();
    const outsider = await ctx.connect(ctx.user());
    for (const sessionId of [r.state.id, randomUUID()]) {
      expect(
        await command(outsider, 'room:subscribe', { sessionId }),
      ).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_FOUND' } });
    }
    expect(
      await command(r.host, 'room:join', { code: r.state.code }),
    ).toMatchObject({ ok: false, error: { code: 'HOST_CANNOT_PARTICIPATE' } });
    data(await command(r.host, 'game:start', { sessionId: r.state.id }));
    expect(
      await command(outsider, 'room:join', { code: r.state.code }),
    ).toMatchObject({ ok: false, error: { code: 'SESSION_NOT_JOINABLE' } });
    expect(
      data(
        await command<RealtimeJoinResult>(r.socket, 'room:join', {
          code: r.state.code,
        }),
      ).participant,
    ).toEqual(r.joined.participant);
  });

  it('impide game:start/advance/finish ajenos sin importar otras rooms', async () => {
    const a = await room();
    const b = await room();
    for (const socket of [a.socket, b.host]) {
      for (const event of ['game:start', 'game:advance', 'game:finish']) {
        const payload =
          event === 'game:advance'
            ? { sessionId: a.state.id, expectedQuestionId: randomUUID() }
            : { sessionId: a.state.id };
        expect(await command(socket, event, payload)).toMatchObject({
          ok: false,
          error: { code: 'HOST_REQUIRED' },
        });
      }
    }
    expect((await ctx.rooms.state(a.owner, a.state.id)).status).toBe('WAITING');
    expect(a.events.some((event) => event.event === 'question:opened')).toBe(
      false,
    );
  });

  it('inicia sin suscripción previa y dos inicios simultáneos abren una sola vez', async () => {
    const r = await room();
    const secondHost = await ctx.connect(r.owner);
    const responses = await Promise.all(
      [r.host, secondHost].map((socket) =>
        command(socket, 'game:start', { sessionId: r.state.id }),
      ),
    );
    expect(responses.filter((response) => response.ok)).toHaveLength(1);
    expect(responses.find((response) => !response.ok)).toMatchObject({
      error: { code: 'SESSION_ALREADY_STARTED' },
    });
    await flush();
    expect(
      r.events.filter((event) => event.event === 'question:opened'),
    ).toHaveLength(1);
    // A command does not subscribe its sender implicitly.
    const unobserved = collect(secondHost);
    data(await command(secondHost, 'game:finish', { sessionId: r.state.id }));
    await flush();
    expect(unobserved).toEqual([]);
  });

  it.each([
    null,
    [],
    'wrong',
    2,
    {},
    { sessionId: 'not-uuid' },
    { sessionId: randomUUID(), userId: randomUUID() },
    { sessionId: randomUUID(), actorId: randomUUID() },
    { sessionId: randomUUID(), role: 'host' },
  ])('rechaza payload inválido o de suplantación: %j', async (payload) => {
    const socket = await ctx.connect(ctx.user());
    expect(await command(socket, 'game:start', payload)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('no ejecuta comandos sin callback y los desconocidos no insertan Answer', async () => {
    const r = await room();
    r.host.emit('game:start', { sessionId: r.state.id });
    const outsider = await ctx.connect(ctx.user());
    outsider.emit('room:join', { code: r.state.code });
    await flush();
    expect((await ctx.rooms.state(r.owner, r.state.id)).status).toBe('WAITING');
    expect(
      (await ctx.rooms.state(r.owner, r.state.id)).participants,
    ).toHaveLength(1);
    for (const event of ['unknown']) {
      expect(await command(r.socket, event, { choice: true })).toMatchObject({
        ok: false,
        error: { code: 'EVENT_NOT_SUPPORTED' },
      });
    }
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
  });

  it('envía una sola respuesta ack y no filtra fallos internos', async () => {
    const r = await room();
    const ack = jest.fn();
    const exception = jest.fn();
    r.host.on('exception', exception);
    jest
      .spyOn(ctx.lifecycle, 'start')
      .mockRejectedValueOnce(new Error('SQL contraseña privada'));
    r.host.emit('game:start', { sessionId: r.state.id }, ack);
    await flush();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack.mock.calls[0][0]).toEqual({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno' },
    });
    expect(exception).not.toHaveBeenCalled();
  });

  it('ambos dispositivos y host reciben la misma pregunta sin solución abierta', async () => {
    const r = await room(30);
    const other = await ctx.connect(r.player);
    const otherEvents = collect(other);
    data(await command(other, 'room:subscribe', { sessionId: r.state.id }));
    const start = data(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    );
    await flush();
    const opened = r.events.find(
      (event) => event.event === 'question:opened',
    )!.room;
    expect(
      otherEvents.find((event) => event.event === 'question:opened')!.room,
    ).toEqual(opened);
    expect(
      r.hostEvents.find((event) => event.event === 'question:opened')!.room,
    ).toEqual(opened);
    expect(start).toEqual(opened);
    expect(start.remainingMs).toBe(30_000);
    expect(start.state.currentQuestion!.imageUrl).toBeNull();
    for (const envelope of [
      start,
      ...r.events.map((event) => event.room),
      ...r.hostEvents.map((event) => event.room),
    ]) {
      expect(JSON.stringify(envelope)).not.toMatch(
        /correctBoolean|imageKey|sessionQuestionId|"answers"|"questions"/,
      );
    }
    expect(Object.keys(start).sort()).toEqual(
      [
        'sessionId',
        'streamId',
        'sequence',
        'serverTime',
        'remainingMs',
        'reviewDurationSeconds',
        'scoreboard',
        'state',
      ].sort(),
    );
  });

  it('recupera tiempo actual, comparte deadline y no amplía en el límite exacto', async () => {
    const r = await room(30);
    const initial = data(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    );
    ctx.clock.advance(10_000);
    const current = data(
      await command(r.socket, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(current.remainingMs).toBe(20_000);
    expect(current.state.currentQuestion!.closesAt).toBe(
      initial.state.currentQuestion!.closesAt,
    );
    expect(current.serverTime).toBe(current.state.serverTime);
    expect(current.sequence).toBe(initial.sequence);
    ctx.clock.advance(20_000);
    const expired = data(
      await command(r.socket, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(expired.remainingMs).toBe(0);
    expect(expired.state.phase).toBe('ANSWERING');
    expect(JSON.stringify(expired)).not.toContain('correctBoolean');
  });

  it('publica plazos sin host, revisión completa y siguiente apertura sin solución', async () => {
    const r = await room();
    const first = data(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    );
    expect(
      await command(r.host, 'game:advance', {
        sessionId: r.state.id,
        expectedQuestionId: first.state.currentQuestion!.id,
      }),
    ).toMatchObject({ error: { code: 'QUESTION_NOT_CLOSED' } });
    r.host.disconnect();
    ctx.clock.advance(15_000);
    await ctx.deadlines.tick();
    await flush();
    const closed = r.events.find(
      (event) => event.event === 'question:closed',
    )!.room;
    expect(closed.state.phase).toBe('REVIEW');
    expect(closed.state.currentQuestion).toHaveProperty('correctBoolean', true);
    expect(
      Date.parse(closed.state.currentQuestion!.reviewEndsAt!) -
        Date.parse(closed.state.currentQuestion!.closedAt!),
    ).toBe(5_000);
    const host = await ctx.connect(r.owner);
    expect(
      await command(host, 'game:advance', {
        sessionId: r.state.id,
        expectedQuestionId: first.state.currentQuestion!.id,
      }),
    ).toMatchObject({ error: { code: 'REVIEW_IN_PROGRESS' } });
    ctx.clock.advance(5_000);
    await ctx.deadlines.tick();
    expect(
      await command(host, 'game:advance', {
        sessionId: r.state.id,
        expectedQuestionId: first.state.currentQuestion!.id,
      }),
    ).toMatchObject({ error: { code: 'STALE_QUESTION' } });
    await flush();
    const next = r.events
      .filter((event) => event.event === 'question:opened')
      .at(-1)!.room;
    expect(next.state.currentIndex).toBe(1);
    expect(JSON.stringify(next)).not.toContain('correctBoolean');
    expect(next.remainingMs).toBe(15_000);
    ctx.clock.advance(20_000);
    await ctx.deadlines.tick();
    await flush();
    expect(r.events.at(-1)!.event).toBe('game:finished');
    expect(r.events.at(-1)!.room.state.currentQuestion).toBeNull();
  });

  it.each(['WAITING', 'ANSWERING', 'REVIEW'])(
    'finaliza anticipadamente desde %s sin revisión artificial',
    async (phase) => {
      const r = await room();
      if (phase !== 'WAITING')
        data(await command(r.host, 'game:start', { sessionId: r.state.id }));
      if (phase === 'REVIEW') {
        ctx.clock.advance(15_000);
        await ctx.deadlines.tick();
      }
      await flush();
      const closedBefore = r.events.filter(
        (event) => event.event === 'question:closed',
      ).length;
      const finished = data(
        await command(r.host, 'game:finish', { sessionId: r.state.id }),
      );
      await flush();
      expect(finished.state.phase).toBe('FINISHED');
      expect(finished.state.currentQuestion).toBeNull();
      expect(finished.state.results).toHaveLength(1);
      expect(
        r.events.filter((event) => event.event === 'question:closed'),
      ).toHaveLength(closedBefore);
      expect(
        await command(r.host, 'game:start', { sessionId: r.state.id }),
      ).toMatchObject({ error: { code: 'SESSION_FINISHED' } });
      expect(
        data(
          await command(r.socket, 'room:subscribe', { sessionId: r.state.id }),
        ).state.status,
      ).toBe('FINISHED');
      expect(
        await command(r.socket, 'room:join', { code: r.state.code }),
      ).toMatchObject({
        ok: true,
        data: {
          participant: r.joined.participant,
          room: { state: { status: 'FINISHED' } },
        },
      });
      const outsider = await ctx.connect(ctx.user());
      expect(
        await command(outsider, 'room:join', { code: r.state.code }),
      ).toMatchObject({ error: { code: 'SESSION_FINISHED' } });
    },
  );

  it('dos salas aíslan todos sus broadcasts incluidos REST y plazos simultáneos', async () => {
    const a = await room(15);
    const b = await room(30);
    data(await command(a.host, 'game:start', { sessionId: a.state.id }));
    data(await command(b.host, 'game:start', { sessionId: b.state.id }));
    ctx.clock.advance(15_000);
    await ctx.deadlines.tick();
    data(await command(a.host, 'game:finish', { sessionId: a.state.id }));
    data(await command(b.host, 'game:finish', { sessionId: b.state.id }));
    await flush();
    for (const [r, id] of [
      [a, a.state.id],
      [b, b.state.id],
    ] as const) {
      expect(r.events.length).toBeGreaterThan(2);
      for (const entry of [...r.events, ...r.hostEvents]) {
        expect(entry.room.sessionId).toBe(id);
        expect(entry.room.state.id).toBe(id);
      }
    }
  });

  it('salida REST retira todos los dispositivos y notifica al host', async () => {
    const r = await room();
    const second = await ctx.connect(r.player);
    const secondEvents = collect(second);
    data(await command(second, 'room:subscribe', { sessionId: r.state.id }));
    const token = await ctx.token(r.player);
    await request(ctx.app.getHttpServer())
      .delete(`/sessions/${r.state.id}/participants/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await flush();
    expect(r.hostEvents.at(-1)!.room.state.participants).toEqual([]);
    const before = r.events.length;
    const secondBefore = secondEvents.length;
    const other = ctx.user();
    await request(ctx.app.getHttpServer())
      .post('/sessions/join')
      .set('Authorization', `Bearer ${await ctx.token(other)}`)
      .send({ code: r.state.code })
      .expect(200);
    data(await command(r.host, 'game:start', { sessionId: r.state.id }));
    await flush();
    expect(r.events).toHaveLength(before);
    expect(secondEvents).toHaveLength(secondBefore);
    expect(
      await command(second, 'room:subscribe', { sessionId: r.state.id }),
    ).toMatchObject({ error: { code: 'SESSION_NOT_FOUND' } });
    expect(
      await command(second, 'room:leave', { sessionId: r.state.id }),
    ).toMatchObject({ error: { code: 'SESSION_NOT_LEAVABLE' } });
  });

  it('salida WebSocket es idempotente y compite de forma segura con suscripción', async () => {
    const r = await room();
    const second = await ctx.connect(r.player);
    await Promise.all([
      command(second, 'room:subscribe', { sessionId: r.state.id }),
      command(r.socket, 'room:leave', { sessionId: r.state.id }),
    ]);
    const afterLeave = collect(second);
    data(await command(r.socket, 'room:leave', { sessionId: r.state.id }));
    await ctx.rooms.join(ctx.user(), r.state.code);
    data(await command(r.host, 'game:start', { sessionId: r.state.id }));
    await flush();
    expect(afterLeave).toEqual([]);
  });

  it('suscribirse compitiendo con inicio no pierde la transición', async () => {
    const r = await room();
    const second = await ctx.connect(r.player);
    const events = collect(second);
    const [initial] = await Promise.all([
      command(second, 'room:subscribe', { sessionId: r.state.id }),
      command(r.host, 'game:start', { sessionId: r.state.id }),
    ]);
    await flush();
    const state = data(initial);
    const latest = events.at(-1)?.room ?? state;
    expect(latest.state.phase).toBe('ANSWERING');
    expect(latest.sequence).toBeGreaterThanOrEqual(state.sequence);
  });

  it('snapshot conserva texto, orden, solución e imagen ante editar y borrar el quiz', async () => {
    const { owner, quiz } = await ctx.seedQuiz(2);
    await ctx.dataSource
      .getRepository(Question)
      .update(
        { quizId: quiz.id, position: 0 },
        { imageKey: 'original/image.png' },
      );
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 30,
    });
    const host = await ctx.connect(owner);
    const player = ctx.user();
    const socket = await ctx.connect(player);
    data(await command(socket, 'room:join', { code: state.code }));
    await ctx.dataSource.getRepository(Question).update(
      { quizId: quiz.id },
      {
        statement: 'edited',
        correctBoolean: false,
        imageKey: 'new/image.png',
      },
    );
    await ctx.dataSource
      .getRepository(Quiz)
      .update(quiz.id, { title: 'edited' });
    const originals = await ctx.dataSource
      .getRepository(Question)
      .find({ where: { quizId: quiz.id }, order: { position: 'ASC' } });
    await ctx.dataSource
      .getRepository(Question)
      .update(originals[0].id, { position: 10 });
    await ctx.dataSource
      .getRepository(Question)
      .update(originals[1].id, { position: 0 });
    await ctx.dataSource
      .getRepository(Question)
      .update(originals[0].id, { position: 1 });
    ctx.storage.signedUrl.mockClear();
    const start = data(
      await command(host, 'game:start', { sessionId: state.id }),
    );
    expect(start.state.quizTitle).toBe('Cuestionario de prueba');
    expect(start.state.currentQuestion).toMatchObject({
      position: 0,
      statement: 'Pregunta 0',
      imageUrl: 'https://storage.test/signed/image.png',
    });
    expect(
      ctx.storage.signedUrl.mock.calls.some(
        (call: unknown[]) => call[0] === 'original/image.png',
      ),
    ).toBe(true);
    expect(ctx.storage.signedUrl).toHaveBeenCalledTimes(1);
    await ctx.dataSource.getRepository(Quiz).delete(quiz.id);
    socket.disconnect();
    const reconnected = await ctx.connect(player);
    const recovered = data(
      await command(reconnected, 'room:subscribe', { sessionId: state.id }),
    );
    expect(recovered.state.currentQuestion).toEqual(
      start.state.currentQuestion,
    );
    ctx.clock.advance(30_000);
    await ctx.deadlines.tick();
    expect(
      data(
        await command(reconnected, 'room:subscribe', { sessionId: state.id }),
      ).state.currentQuestion,
    ).toHaveProperty('correctBoolean', true);
  });

  it('no publica rollback, rejoin o plazos obsoletos; fallo posterior no revierte commit', async () => {
    const r = await room();
    await flush();
    const before = r.hostEvents.length;
    data(
      await command<RealtimeJoinResult>(r.socket, 'room:join', {
        code: r.state.code,
      }),
    );
    await flush();
    expect(r.hostEvents).toHaveLength(before);
    const persist = ctx.repository.persist.bind(ctx.repository);
    jest
      .spyOn(ctx.repository, 'persist')
      .mockImplementationOnce(async (manager, aggregate) => {
        await persist(manager, aggregate);
        throw new Error('rollback');
      });
    expect(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    ).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(r.hostEvents).toHaveLength(before);
    expect((await ctx.rooms.state(r.owner, r.state.id)).status).toBe('WAITING');
    jest
      .spyOn(ctx.app.get(SessionRealtimeHub), 'changed')
      .mockRejectedValueOnce(new Error('delivery failure'));
    const opened = data(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    );
    expect(opened.state.status).toBe('IN_PROGRESS');
    await ctx.lifecycle.processDeadline({
      sessionId: r.state.id,
      expectedQuestionId: randomUUID(),
      kind: 'ANSWER',
      expectedDeadline: new Date(0),
    });
    expect(
      data(await command(r.socket, 'room:subscribe', { sessionId: r.state.id }))
        .sequence,
    ).toBe(opened.sequence);
  });

  it('notifica cierre por respuestas internas y clasificación confirmada', async () => {
    const r = await room();
    const first = data(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    );
    ctx.clock.advance(1_000);
    await ctx.dataSource.getRepository(Answer).save({
      sessionQuestionId: first.state.currentQuestion!.id,
      participantId: r.joined.participant.id,
      choice: true,
      score: 100,
      answeredAt: ctx.clock.now(),
    });
    await ctx.lifecycle.evaluateAcceptedAnswers({
      sessionId: r.state.id,
      expectedQuestionId: first.state.currentQuestion!.id,
    });
    await flush();
    expect(r.events.some((event) => event.event === 'question:closed')).toBe(
      true,
    );
    expect(r.events.at(-1)!.event).toBe('scoreboard:updated');
  });

  it('recuperación atrasada publica siguiente apertura sin revisión histórica', async () => {
    const r = await room();
    const opened = data(
      await command(r.host, 'game:start', { sessionId: r.state.id }),
    );
    ctx.clock.advance(90_000);
    await ctx.deadlines.tick();
    await flush();
    expect(r.events.some((event) => event.event === 'question:closed')).toBe(
      false,
    );
    expect(r.events.at(-1)!.room.state.currentIndex).toBe(1);
    expect(r.events.at(-1)!.room.remainingMs).toBe(15_000);
    expect(
      r.events
        .filter((entry) => entry.room.sequence > opened.sequence)
        .map((entry) => entry.event),
    ).toEqual(['room:state', 'question:opened', 'scoreboard:updated']);
  });

  it('firma lenta mantiene orden y el tiempo restante se calcula después de firmar', async () => {
    const r = await room(30);
    await ctx.dataSource
      .getRepository(Question)
      .update({ quizId: r.quiz.id }, { imageKey: 'too-late-original' });
    // Session snapshot is deliberately unchanged: inject a controlled projection
    // delay rather than mutate that snapshot for this ordering test.
    const projector = ctx.app.get(SessionStateProjector);
    const project = projector.project.bind(projector);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest
      .spyOn(projector, 'project')
      .mockImplementationOnce(async (snapshot, signal) => {
        entered();
        await gate;
        ctx.clock.advance(2_000);
        return project(snapshot, signal);
      });
    const starting = command(r.host, 'game:start', { sessionId: r.state.id });
    await started;
    const finishing = command(r.socket, 'room:subscribe', {
      sessionId: r.state.id,
    });
    release();
    const opened = data(await starting);
    expect(opened.remainingMs).toBe(28_000);
    const subscribed = data(await finishing);
    expect(subscribed.sequence).toBe(opened.sequence);
    await flush();
    expect(r.events.map((event) => event.room.sequence)).toEqual(
      [...r.events.map((event) => event.room.sequence)].sort((a, b) => a - b),
    );
  });
});
