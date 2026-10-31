import { randomUUID } from 'crypto';
import request from 'supertest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Question } from '../../src/quizzes/question.entity';
import { Quiz } from '../../src/quizzes/quiz.entity';
import { ActiveSessionMembership } from '../../src/sessions/active-session-membership.entity';
import { GameSession } from '../../src/sessions/game-session.entity';
import { SessionParticipant } from '../../src/sessions/session-participant.entity';
import type {
  SessionState,
  JoinSessionResult,
} from '../../src/sessions/session.contracts';
import { createSessionTestContext } from '../support/session-test-context';
import type { SessionTestContext } from '../support/session-test-context';

describe('Contratos REST y participación de salas', () => {
  let ctx: SessionTestContext;
  beforeAll(async () => {
    ctx = await createSessionTestContext();
  });
  beforeEach(async () => {
    await ctx.reset();
  });
  afterAll(async () => {
    await ctx?.close();
  });

  async function room(duration: 15 | 30 = 30) {
    const { owner, quiz } = await ctx.seedQuiz();
    return {
      owner,
      quiz,
      state: await ctx.rooms.create(owner, {
        quizId: quiz.id,
        questionDurationSeconds: duration,
      }),
    };
  }

  it.each(['create', 'join', 'state', 'leave'])(
    'rechaza %s sin JWT y con token inválido',
    async (route) => {
      const { state } = await room();
      for (const token of [null, 'Bearer token-invalido']) {
        const operation =
          route === 'create'
            ? request(ctx.app.getHttpServer()).post('/sessions').send({})
            : route === 'join'
              ? request(ctx.app.getHttpServer())
                  .post('/sessions/join')
                  .send({ code: state.code })
              : route === 'state'
                ? request(ctx.app.getHttpServer()).get(`/sessions/${state.id}`)
                : request(ctx.app.getHttpServer()).delete(
                    `/sessions/${state.id}/participants/me`,
                  );
        if (token) operation.set('Authorization', token);
        const response = await operation.expect(401);
        expect(response.body).toEqual({
          statusCode: 401,
          code: 'UNAUTHORIZED',
          message: expect.any(String),
        });
      }
      expect(
        await ctx.dataSource.getRepository(SessionParticipant).count(),
      ).toBe(0);
    },
  );

  it.each([15, 30] as const)(
    'crea por REST con duración %i y contrato exacto',
    async (duration) => {
      const { owner, quiz } = await ctx.seedQuiz();
      const response = await request(ctx.app.getHttpServer())
        .post('/sessions')
        .set('Authorization', ctx.token(owner))
        .send({ quizId: quiz.id, questionDurationSeconds: duration })
        .expect(201);
      const state = response.body as SessionState;
      expect(Object.keys(state).sort()).toEqual(
        [
          'id',
          'code',
          'hostId',
          'quizTitle',
          'status',
          'phase',
          'questionDurationSeconds',
          'currentIndex',
          'questionsCount',
          'startedAt',
          'finishedAt',
          'serverTime',
          'participants',
          'currentQuestion',
          'results',
        ].sort(),
      );
      expect(state).toMatchObject({
        status: 'WAITING',
        phase: 'WAITING',
        questionDurationSeconds: duration,
        currentIndex: -1,
        participants: [],
        currentQuestion: null,
        results: null,
      });
      expect(state.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(
        await ctx.dataSource.getRepository(SessionParticipant).count(),
      ).toBe(0);
    },
  );

  it.each(['15', 4, 121, 5.5, null, true])(
    'rechaza duración %s y no crea la sala',
    async (duration) => {
      const { owner, quiz } = await ctx.seedQuiz();
      const response = await request(ctx.app.getHttpServer())
        .post('/sessions')
        .set('Authorization', ctx.token(owner))
        .send({ quizId: quiz.id, questionDurationSeconds: duration })
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(await ctx.dataSource.getRepository(GameSession).count()).toBe(0);
    },
  );

  it.each([
    { input: {}, answer: 30, review: 5 },
    {
      input: { questionDurationSeconds: 5, reviewDurationSeconds: 3 },
      answer: 5,
      review: 3,
    },
    {
      input: { questionDurationSeconds: 120, reviewDurationSeconds: 15 },
      answer: 120,
      review: 15,
    },
    { input: { questionDurationSeconds: 20 }, answer: 20, review: 5 },
  ])(
    'acepta tiempos custom/defaults $input sin cambiar el shape REST',
    async ({ input, answer, review }) => {
      const { owner, quiz } = await ctx.seedQuiz();
      const result = await request(ctx.app.getHttpServer())
        .post('/sessions')
        .set('Authorization', ctx.token(owner))
        .send({ quizId: quiz.id, ...input })
        .expect(201);
      expect(result.body.questionDurationSeconds).toBe(answer);
      expect(result.body).not.toHaveProperty('reviewDurationSeconds');
      expect(result.body).not.toHaveProperty('scoreboard');
      const persisted = await ctx.repository.read(result.body.id as string);
      expect(persisted.session.reviewDurationSeconds).toBe(review);
    },
  );

  it.each([null, '5', true, 2, 16, 3.5])(
    'rechaza revisión inválida %s sin crear sala',
    async (reviewDurationSeconds) => {
      const { owner, quiz } = await ctx.seedQuiz();
      const result = await request(ctx.app.getHttpServer())
        .post('/sessions')
        .set('Authorization', ctx.token(owner))
        .send({ quizId: quiz.id, reviewDurationSeconds })
        .expect(400);
      expect(result.body.code).toBe('VALIDATION_ERROR');
      expect(await ctx.dataSource.getRepository(GameSession).count()).toBe(0);
    },
  );

  it('rechaza campos extra, UUID inválido, cuestionario ajeno y código inexistente', async () => {
    const { owner, quiz, state } = await room();
    const other = ctx.user();
    for (const quizId of [quiz.id, randomUUID()]) {
      const response = await request(ctx.app.getHttpServer())
        .post('/sessions')
        .set('Authorization', ctx.token(other))
        .send({ quizId, questionDurationSeconds: 30 })
        .expect(404);
      expect(response.body.code).toBe('QUIZ_NOT_FOUND');
    }
    for (const input of [
      { quizId: 'incorrecto', questionDurationSeconds: 30 },
      { quizId: quiz.id, questionDurationSeconds: 30, hostId: owner.id },
    ]) {
      await request(ctx.app.getHttpServer())
        .post('/sessions')
        .set('Authorization', ctx.token(owner))
        .send(input)
        .expect(400);
    }
    const auth = ctx.token(other);
    await request(ctx.app.getHttpServer())
      .post('/sessions/join')
      .set('Authorization', auth)
      .send({ code: state.code, userId: owner.id })
      .expect(400);
    expect(
      (
        await request(ctx.app.getHttpServer())
          .post('/sessions/join')
          .set('Authorization', auth)
          .send({ code: 'ZZZZZZ' })
          .expect(404)
      ).body.code,
    ).toBe('SESSION_NOT_FOUND');
    expect(
      (
        await request(ctx.app.getHttpServer())
          .get('/sessions/not-a-uuid')
          .set('Authorization', auth)
          .expect(400)
      ).body.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('join normalizado y segundo join concurrente conservan identidad y fecha', async () => {
    const { state } = await room();
    const player = ctx.user();
    const auth = ctx.token(player);
    const join = () =>
      request(ctx.app.getHttpServer())
        .post('/sessions/join')
        .set('Authorization', auth)
        .send({ code: ` ${state.code.toLowerCase()} ` })
        .expect(200);
    const [a, b] = await Promise.all([join(), join()]);
    expect((a.body as JoinSessionResult).participant).toEqual(
      (b.body as JoinSessionResult).participant,
    );
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      1,
    );
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(1);
  });

  it('dos joins del mismo usuario a salas distintas tienen solo un ganador', async () => {
    const first = await room();
    const second = await room();
    expect(first.state.code).not.toBe(second.state.code);
    const auth = ctx.token(ctx.user());
    const responses = await Promise.all(
      [first, second].map(({ state }) =>
        request(ctx.app.getHttpServer())
          .post('/sessions/join')
          .set('Authorization', auth)
          .send({ code: state.code }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)!.body.code).toBe(
      'ALREADY_IN_ACTIVE_SESSION',
    );
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      1,
    );
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(1);
  });

  it('salir en espera libera la reserva, es idempotente y permite entrar en otra sala', async () => {
    const first = await room();
    const second = await room();
    const player = ctx.user();
    await ctx.rooms.join(player, first.state.code);
    const auth = ctx.token(player);
    for (let i = 0; i < 2; i++)
      await request(ctx.app.getHttpServer())
        .delete(`/sessions/${first.state.id}/participants/me`)
        .set('Authorization', auth)
        .expect(204);
    await ctx.rooms.join(player, second.state.code);
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(1);
    expect(
      (await ctx.rooms.state(second.owner, second.state.id)).participants[0]
        .userId,
    ).toBe(player.id);
  });

  it('prohíbe al host jugar, permite rejoin existente en curso y bloquea nuevos joins/salidas', async () => {
    const { owner, state } = await room();
    const hostAuth = ctx.token(owner);
    expect(
      (
        await request(ctx.app.getHttpServer())
          .post('/sessions/join')
          .set('Authorization', hostAuth)
          .send({ code: state.code })
          .expect(403)
      ).body.code,
    ).toBe('HOST_CANNOT_PARTICIPATE');
    const player = ctx.user();
    const joined = await ctx.rooms.join(player, state.code);
    await ctx.lifecycle.start({ sessionId: state.id, actorId: owner.id });
    expect((await ctx.rooms.join(player, state.code)).participant).toEqual(
      joined.participant,
    );
    await expect(ctx.rooms.join(ctx.user(), state.code)).rejects.toMatchObject({
      code: 'SESSION_NOT_JOINABLE',
    });
    expect(
      (
        await request(ctx.app.getHttpServer())
          .delete(`/sessions/${state.id}/participants/me`)
          .set('Authorization', ctx.token(player))
          .expect(409)
      ).body.code,
    ).toBe('SESSION_NOT_LEAVABLE');
  });

  it('solo host y participantes consultan y la copia sobrevive a editar/borrar el original', async () => {
    const { owner, quiz, state } = await room();
    const player = ctx.user();
    await ctx.rooms.join(player, state.code);
    const before = await ctx.repository.read(state.id);
    await ctx.dataSource
      .getRepository(Question)
      .update(
        { quizId: quiz.id },
        { statement: 'Cambio posterior', correctBoolean: false },
      );
    await ctx.dataSource
      .getRepository(Quiz)
      .update(quiz.id, { title: 'Otro título' });
    await ctx.dataSource.getRepository(Quiz).delete(quiz.id);
    const after = await ctx.repository.read(state.id);
    expect(after.session.quizId).toBeNull();
    expect(after.session.quizTitle).toBe(state.quizTitle);
    expect(
      after.questions.map(({ statement, correctBoolean, imageKey }) => ({
        statement,
        correctBoolean,
        imageKey,
      })),
    ).toEqual(
      before.questions.map(({ statement, correctBoolean, imageKey }) => ({
        statement,
        correctBoolean,
        imageKey,
      })),
    );
    await request(ctx.app.getHttpServer())
      .get(`/sessions/${state.id}`)
      .set('Authorization', ctx.token(owner))
      .expect(200);
    await request(ctx.app.getHttpServer())
      .get(`/sessions/${state.id}`)
      .set('Authorization', ctx.token(player))
      .expect(200);
    for (const id of [state.id, randomUUID()])
      expect(
        (
          await request(ctx.app.getHttpServer())
            .get(`/sessions/${id}`)
            .set('Authorization', ctx.token(ctx.user()))
            .expect(404)
        ).body.code,
      ).toBe('SESSION_NOT_FOUND');
  });

  it('oculta soluciones abiertas y preguntas futuras; revela solo la actual durante revisión', async () => {
    const { owner, state } = await room(15);
    const player = ctx.user();
    await ctx.rooms.join(player, state.code);
    await ctx.lifecycle.start({ sessionId: state.id, actorId: owner.id });
    const current = (await ctx.repository.read(state.id)).questions[0];
    for (const user of [owner, player]) {
      const response = await request(ctx.app.getHttpServer())
        .get(`/sessions/${state.id}`)
        .set('Authorization', ctx.token(user))
        .expect(200);
      expect(response.body.currentQuestion).not.toHaveProperty(
        'correctBoolean',
      );
      expect(response.body).not.toHaveProperty('questions');
      expect(response.body.currentQuestion).not.toHaveProperty('imageKey');
    }
    ctx.clock.advance(15_000);
    await ctx.deadlines.tick();
    const review = await ctx.rooms.state(player, state.id);
    expect(review.phase).toBe('REVIEW');
    expect(review.currentQuestion).toMatchObject({
      id: current.id,
      correctBoolean: true,
      status: 'CLOSED',
    });
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      1,
    );
  });

  it('reintenta una colisión con transacción nueva y agota diez intentos sin duplicados', async () => {
    const { owner, quiz } = await ctx.seedQuiz();
    const generate = jest
      .spyOn(ctx.codes, 'generate')
      .mockReturnValue('ABC234');
    await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 30,
    });
    generate.mockReturnValueOnce('ABC234').mockReturnValueOnce('DEF567');
    await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 30,
    });
    const response = await request(ctx.app.getHttpServer())
      .post('/sessions')
      .set('Authorization', ctx.token(owner))
      .send({ quizId: quiz.id, questionDurationSeconds: 30 })
      .expect(503);
    expect(response.body.code).toBe('ROOM_CODE_UNAVAILABLE');
    expect(await ctx.dataSource.getRepository(GameSession).count()).toBe(2);
  });

  it('no filtra errores internos y conserva el formato de errores de otras rutas', async () => {
    jest
      .spyOn(ctx.rooms, 'create')
      .mockRejectedValueOnce(
        new Error('SQL y credenciales que no deben salir'),
      );
    const response = await request(ctx.app.getHttpServer())
      .post('/sessions')
      .set('Authorization', ctx.token(ctx.user()))
      .send({ quizId: randomUUID(), questionDurationSeconds: 30 })
      .expect(500);
    expect(response.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno',
    });
    expect(
      (
        await request(ctx.app.getHttpServer())
          .get('/ruta-ajena-inexistente')
          .expect(404)
      ).body,
    ).not.toHaveProperty('code');
  });

  it('publica rutas y schemas en OpenAPI sin endpoints de control nuevos', () => {
    const document = SwaggerModule.createDocument(
      ctx.app,
      new DocumentBuilder().build(),
    );
    expect(
      Object.keys(document.paths)
        .filter((path) => path.startsWith('/sessions'))
        .sort(),
    ).toEqual([
      '/sessions',
      '/sessions/join',
      '/sessions/{code}/state',
      '/sessions/{id}',
      '/sessions/{id}/participants/me',
    ]);
    expect(
      document.paths['/sessions/join'].post!.responses['200'],
    ).toBeDefined();
    const creation = document.components!.schemas!.CreateSessionDto;
    expect(creation).toMatchObject({
      required: ['quizId'],
      properties: {
        quizId: { format: 'uuid' },
        questionDurationSeconds: {
          type: 'integer',
          minimum: 5,
          maximum: 120,
          default: 30,
        },
        reviewDurationSeconds: {
          type: 'integer',
          minimum: 3,
          maximum: 15,
          default: 5,
        },
      },
    });
    expect(creation).not.toHaveProperty(
      'properties.questionDurationSeconds.enum',
    );
    const response = document.paths['/sessions'].post!.responses['201'];
    expect(response).not.toHaveProperty(
      'content.application/json.schema.properties.scoreboard',
    );
    expect(response).not.toHaveProperty(
      'content.application/json.schema.properties.reviewDurationSeconds',
    );
  });
});
