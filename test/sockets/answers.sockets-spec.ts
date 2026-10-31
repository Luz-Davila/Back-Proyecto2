import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Answer } from '../../src/sessions/answer.entity';
import { GameResult } from '../../src/sessions/game-result.entity';
import { SessionStateProjector } from '../../src/sessions/session-state.projector';
import { SessionRealtimeHub } from '../../src/sessions/realtime/session-realtime.hub';
import type { AnswerReceipt } from '../../src/sessions/session.contracts';
import type { SessionAck } from '../../src/sessions/realtime/session-realtime.contracts';
import {
  collect,
  command,
  createSocketTestContext,
  type SocketTestContext,
} from '../support/socket-test-context';

type AnswerResult = { answer: AnswerReceipt };
function data<T>(ack: SessionAck<T>): T {
  expect(ack.ok).toBe(true);
  if (!ack.ok) throw new Error(ack.error.code);
  return ack.data;
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

describe('answer:submit y clasificación multiusuario por Socket.IO', () => {
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

  async function room(count = 3, duration = 30, review = 5) {
    const { owner, quiz } = await ctx.seedQuiz();
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: duration,
      reviewDurationSeconds: review,
    });
    const host = await ctx.connect(owner);
    data(await command(host, 'room:subscribe', { sessionId: state.id }));
    const users = Array.from({ length: count }, () => ctx.user());
    const sockets = await Promise.all(users.map((user) => ctx.connect(user)));
    for (const socket of sockets)
      data(await command(socket, 'room:join', { code: state.code }));
    const hostEvents = collect(host);
    const events = sockets.map((socket) => collect(socket));
    const opened = data(
      await command(host, 'game:start', { sessionId: state.id }),
    );
    await flush();
    hostEvents.splice(0);
    events.forEach((list) => list.splice(0));
    const input = {
      sessionQuestionId: opened.state.currentQuestion!.id,
      choice: true,
    };
    const answer = (index: number, choice = true) =>
      command<AnswerResult>(sockets[index], 'answer:submit', {
        ...input,
        choice,
      });
    return {
      owner,
      state,
      host,
      users,
      sockets,
      opened,
      input,
      answer,
      hostEvents,
      events,
    };
  }

  it('comprobante es privado, exacto y sin puntaje mientras OPEN', async () => {
    const r = await room();
    ctx.clock.advance(800);
    const project = jest.spyOn(ctx.app.get(SessionStateProjector), 'project');
    const receipt = data(await r.answer(0)).answer;
    expect(project).not.toHaveBeenCalled();
    expect(Object.keys(receipt).sort()).toEqual(
      ['id', 'sessionQuestionId', 'choice', 'answeredAt'].sort(),
    );
    expect(receipt).toMatchObject({
      choice: true,
      sessionQuestionId: r.input.sessionQuestionId,
      answeredAt: ctx.clock.now().toISOString(),
    });
    await flush();
    expect(r.hostEvents).toEqual([]);
    expect(r.events.every((events) => events.length === 0)).toBe(true);
    const state = data(
      await command(r.sockets[1], 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(state.sequence).toBe(r.opened.sequence);
    expect(state.scoreboard.map((row) => row.totalScore)).toEqual([0, 0, 0]);
    expect(JSON.stringify(state)).not.toMatch(
      /correctBoolean|"choice"|"answeredAt"|"score"|scoredAt/,
    );
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
  });

  it('WAITING publica solo filas exactas de cero y excluye al host', async () => {
    const { owner, quiz } = await ctx.seedQuiz();
    const state = await ctx.rooms.create(owner, { quizId: quiz.id });
    const host = await ctx.connect(owner);
    const empty = data(
      await command(host, 'room:subscribe', { sessionId: state.id }),
    );
    expect(empty.scoreboard).toEqual([]);
    const user = ctx.user();
    const joined = await ctx.rooms.join(user, state.code);
    const waiting = data(
      await command(host, 'room:subscribe', { sessionId: state.id }),
    );
    expect(waiting.reviewDurationSeconds).toBe(5);
    expect(waiting.scoreboard).toEqual([
      { participantId: joined.participant.id, totalScore: 0, rank: 1 },
    ]);
    expect(waiting.state.phase).toBe('WAITING');
    expect(waiting.state).not.toHaveProperty('scoreboard');
  });

  it('FINISHED conserva resultados heredados en WS sin recalificar a 0/1/3', async () => {
    const r = await room(1);
    data(await r.answer(0));
    data(await command(r.host, 'game:finish', { sessionId: r.state.id }));
    await ctx.dataSource
      .getRepository(GameResult)
      .update({ sessionId: r.state.id }, { totalScore: 100 });
    const historical = data(
      await command(r.sockets[0], 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(historical.scoreboard).toEqual(historical.state.results);
    expect(historical.scoreboard[0].totalScore).toBe(100);
    expect((await ctx.repository.read(r.state.id)).answers[0].score).toBe(3);
  });

  it.each([
    { choice: 'true' },
    { choice: 1 },
    { choice: null },
    { choice: undefined },
    { userId: randomUUID() },
    { participantId: randomUUID() },
    { sessionId: randomUUID() },
    { answeredAt: '2020-01-01' },
    { score: 999 },
    { role: 'host' },
    { sessionQuestionId: 'bad' },
  ])(
    'rechaza payload $choice y propiedades de suplantación %j',
    async (override) => {
      const r = await room(1);
      const ack = await command(r.sockets[0], 'answer:submit', {
        ...r.input,
        ...override,
      });
      expect(ack).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR' },
      });
      expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    },
  );

  it('verifica JWT por envío, callback obligatorio, host y pertenencia', async () => {
    const r = await room();
    r.sockets[0].emit('answer:submit', r.input);
    await flush();
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    expect(await command(r.host, 'answer:submit', r.input)).toMatchObject({
      error: { code: 'HOST_CANNOT_PARTICIPATE' },
    });
    const outsider = await ctx.connect(ctx.user());
    expect(await command(outsider, 'answer:submit', r.input)).toMatchObject({
      error: { code: 'SESSION_NOT_FOUND' },
    });
    jest
      .spyOn(ctx.auth, 'verifySocketToken')
      .mockRejectedValueOnce(new UnauthorizedException());
    expect(await r.answer(0)).toMatchObject({
      error: { code: 'UNAUTHORIZED' },
    });
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
  });

  it('doble clic/multidispositivo mantiene una Answer y no emite answer:ack', async () => {
    const r = await room(2);
    const second = await ctx.connect(r.users[0]);
    data(await command(second, 'room:subscribe', { sessionId: r.state.id }));
    const separateAck = jest.fn();
    second.on('answer:ack', separateAck);
    const receipts = await Promise.all([
      r.answer(0),
      command<AnswerResult>(second, 'answer:submit', r.input),
      r.answer(0),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[1]).toEqual(receipts[2]);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    expect(separateAck).not.toHaveBeenCalled();
    const before = data(
      await command(second, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(before.sequence).toBe(r.opened.sequence);
    expect(before.scoreboard.every((row) => row.totalScore === 0)).toBe(true);
  });

  it('dos choices concurrentes solo aceptan la primera elección', async () => {
    const r = await room(2);
    const second = await ctx.connect(r.users[0]);
    const responses = await Promise.all([
      r.answer(0),
      command<AnswerResult>(second, 'answer:submit', {
        ...r.input,
        choice: false,
      }),
    ]);
    expect(responses.filter((ack) => ack.ok)).toHaveLength(1);
    expect(responses.find((ack) => !ack.ok)).toMatchObject({
      error: { code: 'ANSWER_ALREADY_SUBMITTED' },
    });
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
  });

  it('última respuesta publica solución y scoreboard con bono solo al primer acierto', async () => {
    const r = await room();
    ctx.clock.advance(400);
    data(await r.answer(0, false));
    ctx.clock.advance(400);
    data(await r.answer(1));
    ctx.clock.advance(700);
    data(await r.answer(2));
    await flush();
    expect(r.hostEvents.map((entry) => entry.event)).toEqual([
      'room:state',
      'question:closed',
      'scoreboard:updated',
    ]);
    const closed = r.hostEvents[0].room;
    expect(
      r.hostEvents.every(
        (entry) => JSON.stringify(entry.room) === JSON.stringify(closed),
      ),
    ).toBe(true);
    expect(closed.state.currentQuestion).toHaveProperty('correctBoolean', true);
    expect(closed.scoreboard.map((row) => [row.totalScore, row.rank])).toEqual([
      [3, 1],
      [1, 2],
      [0, 3],
    ]);
    for (const events of r.events)
      expect(events.map((entry) => entry.room)).toEqual(
        r.hostEvents.map((entry) => entry.room),
      );
    expect(closed.sequence).toBe(r.opened.sequence + 1);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(3);
  });

  it('aciertos simultáneos comparten bono y el de 3000ms exactos no recibe extra', async () => {
    const r = await room();
    ctx.clock.advance(2999);
    await Promise.all([r.answer(0), r.answer(1)]);
    ctx.clock.advance(1);
    data(await r.answer(2));
    const closed = data(
      await command(r.host, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(closed.scoreboard.map((row) => [row.totalScore, row.rank])).toEqual([
      [3, 1],
      [3, 1],
      [1, 2],
    ]);
  });

  it('todos fallan: publica scoreboard aun sin cambiar totales y no repite al reenviar', async () => {
    const r = await room(2);
    data(await r.answer(0, false));
    data(await r.answer(1, false));
    await flush();
    expect(
      r.hostEvents.filter((entry) => entry.event === 'scoreboard:updated'),
    ).toHaveLength(1);
    const before = r.hostEvents.length;
    const receipt = await r.answer(0, false);
    expect(await r.answer(0, false)).toEqual(receipt);
    await flush();
    expect(r.hostEvents).toHaveLength(before);
    expect(
      r.hostEvents.at(-1)!.room.scoreboard.map((row) => row.totalScore),
    ).toEqual([0, 0]);
  });

  it('ack perdido se recupera después del avance y FINISHED sin nuevas sumas', async () => {
    const r = await room(1, 30, 3);
    const first = data(await r.answer(0)).answer;
    ctx.clock.advance(3000);
    await ctx.deadlines.tick();
    const before = data(
      await command(r.host, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(before.state.currentIndex).toBe(1);
    expect(before.scoreboard[0].totalScore).toBe(3);
    const nextSocket = await ctx.connect(r.users[0]);
    expect(
      data(await command<AnswerResult>(nextSocket, 'answer:submit', r.input))
        .answer,
    ).toEqual(first);
    const finished = data(
      await command(r.host, 'game:finish', { sessionId: r.state.id }),
    );
    expect(
      data(await command<AnswerResult>(nextSocket, 'answer:submit', r.input))
        .answer,
    ).toEqual(first);
    expect(finished.state.results).toEqual(finished.scoreboard);
    expect(finished.scoreboard[0].totalScore).toBe(3);
    const recovered = data(
      await command(nextSocket, 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(recovered.sequence).toBe(finished.sequence);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
  });

  it('deadline exacto rechaza; custom revisión avanza sin host y no crea omisiones', async () => {
    const r = await room(2, 5, 3);
    data(await r.answer(0));
    r.host.disconnect();
    ctx.clock.advance(5000);
    expect(await r.answer(1)).toMatchObject({
      error: { code: 'ANSWER_TOO_LATE' },
    });
    await ctx.deadlines.tick();
    const closed = data(
      await command(r.sockets[1], 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(closed.reviewDurationSeconds).toBe(3);
    expect(closed.scoreboard.map((row) => row.totalScore)).toEqual([3, 0]);
    ctx.clock.advance(2999);
    await ctx.deadlines.tick();
    expect(
      data(
        await command(r.sockets[1], 'room:subscribe', {
          sessionId: r.state.id,
        }),
      ).state.currentIndex,
    ).toBe(0);
    ctx.clock.advance(1);
    await ctx.deadlines.tick();
    const next = data(
      await command(r.sockets[1], 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(next.state.currentIndex).toBe(1);
    expect(next.remainingMs).toBe(5000);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
  });

  it('finish y última respuesta concurrentes no duplican puntos ni eventos finales', async () => {
    const r = await room(1);
    ctx.clock.advance(800);
    await Promise.all([
      r.answer(0),
      command(r.host, 'game:finish', { sessionId: r.state.id }),
    ]);
    await flush();
    const snapshot = await ctx.repository.read(r.state.id);
    expect(snapshot.session.status).toBe('FINISHED');
    expect(snapshot.results).toHaveLength(1);
    expect(snapshot.results[0].totalScore).toBe(
      snapshot.answers.length ? 3 : 0,
    );
    expect(
      r.hostEvents.filter((entry) => entry.event === 'scoreboard:updated'),
    ).toHaveLength(1);
    expect(
      r.hostEvents.filter((entry) => entry.event === 'game:finished'),
    ).toHaveLength(1);
    expect(r.hostEvents.at(-1)!.event).toBe('game:finished');
  });

  it('dos salas con ganadores distintos nunca cruzan respuestas o clasificaciones', async () => {
    const a = await room(1, 5, 3),
      b = await room(1, 120, 15);
    ctx.clock.advance(800);
    data(await a.answer(0));
    data(await b.answer(0, false));
    await flush();
    expect(a.hostEvents.at(-1)!.room.scoreboard[0].totalScore).toBe(3);
    expect(b.hostEvents.at(-1)!.room.scoreboard[0].totalScore).toBe(0);
    for (const r of [a, b])
      for (const entry of [...r.hostEvents, ...r.events.flat()]) {
        expect(entry.room.sessionId).toBe(r.state.id);
        expect(entry.room.scoreboard[0].participantId).toBe(
          r.opened.state.participants[0].id,
        );
      }
  });

  it('fallo posterior al commit no pierde comprobante ni repuntúa al resuscribir', async () => {
    const r = await room(1);
    jest
      .spyOn(ctx.app.get(SessionRealtimeHub), 'changed')
      .mockRejectedValueOnce(new Error('delivery'));
    const receipt = data(await r.answer(0)).answer;
    expect(receipt).not.toHaveProperty('score');
    const recovered = data(
      await command(r.sockets[0], 'room:subscribe', { sessionId: r.state.id }),
    );
    expect(recovered.scoreboard[0].totalScore).toBe(3);
    expect(data(await r.answer(0)).answer).toEqual(receipt);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
  });

  it.each([3000, 5000])(
    'firma/cola retrasa admisión %i ms sin retrofechar ni ampliar plazo',
    async (delay) => {
      const r = await room(1, 5, 3);
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
          ctx.clock.advance(delay);
          return project(snapshot, signal);
        });
      const subscription = command(r.host, 'room:subscribe', {
        sessionId: r.state.id,
      });
      await started;
      const pending = r.answer(0);
      release();
      data(await subscription);
      const result = await pending;
      const snapshot = await ctx.repository.read(r.state.id);
      expect(snapshot.questions[0].closesAt).toEqual(
        new Date(Date.parse(r.opened.serverTime) + 5000),
      );
      if (delay === 5000) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: 'ANSWER_TOO_LATE' },
        });
        expect(snapshot.answers).toEqual([]);
      } else {
        expect(data(result).answer.answeredAt).toBe(
          ctx.clock.now().toISOString(),
        );
        expect(snapshot.answers[0].score).toBe(1);
      }
    },
  );

  it('rollback del cierre no publica solución y la cola admite el reintento', async () => {
    const r = await room(1);
    const persist = ctx.repository.persist.bind(ctx.repository);
    jest
      .spyOn(ctx.repository, 'persist')
      .mockImplementationOnce(async (manager, aggregate) => {
        await persist(manager, aggregate);
        throw new Error('score write failure');
      });
    expect(await r.answer(0)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' },
    });
    await flush();
    expect(r.hostEvents).toEqual([]);
    expect(r.events[0]).toEqual([]);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    data(await r.answer(0));
    await flush();
    expect(r.hostEvents.map((entry) => entry.event)).toEqual([
      'room:state',
      'question:closed',
      'scoreboard:updated',
    ]);
  });
});
