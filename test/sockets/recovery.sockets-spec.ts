import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ActiveSessionMembership } from '../../src/sessions/active-session-membership.entity';
import { SessionParticipant } from '../../src/sessions/session-participant.entity';
import { GameResult } from '../../src/sessions/game-result.entity';
import { SessionStateProjector } from '../../src/sessions/session-state.projector';
import type {
  RoomEnvelope,
  RealtimeJoinResult,
  SessionAck,
} from '../../src/sessions/realtime/session-realtime.contracts';
import {
  command,
  collect,
  createSocketTestContext,
  type SocketTestContext,
} from '../support/socket-test-context';

function data<T>(ack: SessionAck<T>): T {
  if (!ack.ok) throw new Error(ack.error.code);
  return ack.data;
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

describe('Recuperación por código HTTP y WS sin participación adicional', () => {
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
  async function room() {
    const { owner, quiz } = await ctx.seedQuiz();
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 5,
      reviewDurationSeconds: 3,
    });
    const player = ctx.user();
    const socket = await ctx.connect(player);
    const joined = data(
      await command<RealtimeJoinResult>(socket, 'room:join', {
        code: state.code,
      }),
    );
    const token = await ctx.token(player);
    const get = (code = state.code, jwt = token) =>
      request(ctx.app.getHttpServer())
        .get(`/sessions/${encodeURIComponent(code)}/state`)
        .set('Authorization', `Bearer ${jwt}`);
    return { owner, state, player, socket, joined, get };
  }

  it('normaliza código, exige auth antes del formato y conserva ruta/schema por id', async () => {
    const r = await room();
    const snapshot = await r.get(` ${r.state.code.toLowerCase()} `).expect(200);
    expect(snapshot.headers['cache-control']).toBe('private, no-store');
    expect(Object.keys(snapshot.body as RoomEnvelope).sort()).toEqual(
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
    expect(snapshot.body.scoreboard).toEqual([
      { participantId: r.joined.participant.id, totalScore: 0, rank: 1 },
    ]);
    for (const invalid of ['bad', 'AAAAA0', 'ABCDEFG', '!ABCDE']) {
      expect((await r.get(invalid).expect(400)).body.code).toBe(
        'VALIDATION_ERROR',
      );
      expect(
        (
          await request(ctx.app.getHttpServer())
            .get(`/sessions/${invalid}/state`)
            .expect(401)
        ).body.code,
      ).toBe('UNAUTHORIZED');
    }
    const byId = await request(ctx.app.getHttpServer())
      .get(`/sessions/${r.state.id}`)
      .set('Authorization', `Bearer ${await ctx.token(r.player)}`)
      .expect(200);
    expect(byId.body).not.toHaveProperty('scoreboard');
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    const response =
      document.paths['/sessions/{code}/state'].get!.responses['200'];
    expect(response).toHaveProperty(
      'content.application/json.schema.properties.scoreboard',
    );
  });

  it('rechazo indistinguible para código ajeno e inexistente; host consulta sin jugar', async () => {
    const r = await room();
    const outsider = await ctx.token(ctx.user());
    expect((await r.get(r.state.code, outsider).expect(404)).body).toEqual(
      (await r.get('ZZZZZZ', outsider).expect(404)).body,
    );
    expect(
      (await r.get(r.state.code, await ctx.token(r.owner)).expect(200)).body
        .state.participants,
    ).toHaveLength(1);
  });

  it.each(['ANSWERING', 'REVIEW', 'FINISHED'] as const)(
    'recupera %s con mismo puntaje, ids y sin secuencia/eventos extra',
    async (phase) => {
      const r = await room();
      await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
      const question = (await ctx.repository.read(r.state.id)).questions[0];
      const receipt = await ctx.answers.submit(r.player, {
        sessionQuestionId: question.id,
        choice: true,
      });
      if (phase === 'ANSWERING') {
        ctx.clock.advance(3000);
        await ctx.deadlines.tick();
      }
      if (phase === 'FINISHED')
        await ctx.lifecycle.finish({
          sessionId: r.state.id,
          actorId: r.owner.id,
        });
      const before = await ctx.repository.read(r.state.id);
      const initial = (await r.get().expect(200)).body as RoomEnvelope;
      r.socket.disconnect();
      const socket = await ctx.connect(r.player);
      const events = collect(socket);
      const joined = data(
        await command<RealtimeJoinResult>(socket, 'room:join', {
          code: r.state.code,
        }),
      );
      const afterHttp = (await r.get().expect(200)).body as RoomEnvelope;
      expect(joined.participant).toEqual(r.joined.participant);
      expect(joined.room.state.phase).toBe(phase);
      expect(joined.room.scoreboard[0].totalScore).toBe(3);
      expect(joined.room.sequence).toBe(initial.sequence);
      expect(afterHttp.sequence).toBe(initial.sequence);
      expect(afterHttp.scoreboard).toEqual(joined.room.scoreboard);
      await flush();
      expect(events).toEqual([]);
      expect(await ctx.repository.read(r.state.id)).toEqual(before);
      expect(
        await ctx.answers.submit(r.player, {
          sessionQuestionId: question.id,
          choice: true,
        }),
      ).toEqual(receipt);
    },
  );

  it('historia recuperada conserva resultados 100 y reserva en otra sala activa', async () => {
    const r = await room();
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    await ctx.dataSource
      .getRepository(GameResult)
      .update({ sessionId: r.state.id }, { totalScore: 100 });
    const { owner, quiz } = await ctx.seedQuiz();
    const next = await ctx.rooms.create(owner, { quizId: quiz.id });
    await ctx.rooms.join(r.player, next.code);
    const reserve = await ctx.dataSource
      .getRepository(ActiveSessionMembership)
      .find();
    const result = data(
      await command<RealtimeJoinResult>(r.socket, 'room:join', {
        code: r.state.code,
      }),
    );
    expect(result.room.scoreboard[0].totalScore).toBe(100);
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).find(),
    ).toEqual(reserve);
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      2,
    );
  });

  it('OPEN vencida solo se lee; HTTP no suscribe al socket', async () => {
    const r = await room();
    const socket = await ctx.connect(r.player);
    const events = collect(socket);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(5000);
    const snapshot = (await r.get().expect(200)).body as RoomEnvelope;
    expect(snapshot.remainingMs).toBe(0);
    expect(snapshot.state.phase).toBe('ANSWERING');
    expect(snapshot.state.currentQuestion).not.toHaveProperty('correctBoolean');
    await ctx.deadlines.tick();
    await flush();
    expect(events).toEqual([]);
  });

  it('lectura y salida se serializan; quien salió pierde consulta', async () => {
    const r = await room();
    const outcomes = await Promise.allSettled([
      ctx.rooms.stateByCode(r.player, r.state.code),
      ctx.rooms.leave(r.player, r.state.id),
    ]);
    expect(outcomes[1].status).toBe('fulfilled');
    await r.get().expect(404);
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      0,
    );
  });

  it('fallo de proyección no muta sala ni publica un cierre; cola sigue usable', async () => {
    const r = await room();
    const before = await ctx.repository.read(r.state.id);
    jest
      .spyOn(ctx.app.get(SessionStateProjector), 'project')
      .mockRejectedValueOnce(new Error('private SQL'));
    expect((await r.get().expect(500)).body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(await ctx.repository.read(r.state.id)).toEqual(before);
    await r.get().expect(200);
  });

  it('consulta lenta y finish quedan ordenados sin ampliar el deadline', async () => {
    const r = await room();
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    const original = ctx.app
      .get(SessionStateProjector)
      .project.bind(ctx.app.get(SessionStateProjector));
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    jest
      .spyOn(ctx.app.get(SessionStateProjector), 'project')
      .mockImplementationOnce(async (snapshot, signal) => {
        entered();
        await gate;
        ctx.clock.advance(5000);
        return original(snapshot, signal);
      });
    const reading = r.get().then((response) => response.body as RoomEnvelope);
    await started;
    const finishing = ctx.lifecycle.finish({
      sessionId: r.state.id,
      actorId: r.owner.id,
    });
    release();
    const before = await reading;
    expect(before.state.phase).toBe('ANSWERING');
    expect(before.remainingMs).toBe(0);
    expect(before.state.currentQuestion).not.toHaveProperty('correctBoolean');
    await finishing;
    const after = (await r.get().expect(200)).body as RoomEnvelope;
    expect(after.state.phase).toBe('FINISHED');
    expect(after.sequence).toBe(before.sequence + 1);
  });
});
