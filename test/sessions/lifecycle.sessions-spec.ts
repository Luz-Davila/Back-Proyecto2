import { Answer } from '../../src/sessions/answer.entity';
import { GameResult } from '../../src/sessions/game-result.entity';
import { ActiveSessionMembership } from '../../src/sessions/active-session-membership.entity';
import { SessionParticipant } from '../../src/sessions/session-participant.entity';
import { SessionDeadlinesService } from '../../src/sessions/session-deadlines.service';
import { createSessionTestContext } from '../support/session-test-context';
import type { SessionTestContext } from '../support/session-test-context';

describe('Motor de partidas y carreras en PostgreSQL', () => {
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

  async function room(duration: 15 | 30 = 15, questions = 2) {
    const { owner, quiz } = await ctx.seedQuiz(questions);
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: duration,
    });
    const player = ctx.user();
    const joined = await ctx.rooms.join(player, state.code);
    return { owner, state, player, participant: joined.participant };
  }

  async function answer(sessionId: string, participantId: string, score = 100) {
    const snapshot = await ctx.repository.read(sessionId);
    const question = snapshot.questions.find(
      (q) => q.position === snapshot.session.currentIndex,
    )!;
    return ctx.dataSource.getRepository(Answer).save({
      sessionQuestionId: question.id,
      participantId,
      answeredAt: ctx.clock.now(),
      choice: true,
      score,
    });
  }

  it('rechaza fuera de orden, falta de permiso y requisitos de inicio', async () => {
    const r = await room();
    await expect(
      ctx.lifecycle.advance({
        sessionId: r.state.id,
        actorId: r.owner.id,
        expectedQuestionId: 'ninguna',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SESSION_STATE' });
    for (const action of ['start', 'finish'] as const)
      await expect(
        ctx.lifecycle[action]({ sessionId: r.state.id, actorId: r.player.id }),
      ).rejects.toMatchObject({ code: 'HOST_REQUIRED' });
    await ctx.rooms.leave(r.player, r.state.id);
    await expect(
      ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id }),
    ).rejects.toMatchObject({ code: 'SESSION_HAS_NO_PARTICIPANTS' });
    const empty = await room(15, 0);
    await expect(
      ctx.lifecycle.start({
        sessionId: empty.state.id,
        actorId: empty.owner.id,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_HAS_NO_QUESTIONS' });
  });

  it('dos solicitudes de inicio simultáneas solo abren una pregunta una vez', async () => {
    const r = await room();
    const command = { sessionId: r.state.id, actorId: r.owner.id };
    const results = await Promise.allSettled([
      ctx.lifecycle.start(command),
      ctx.lifecycle.start(command),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const failed = results.find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: 'SESSION_ALREADY_STARTED' });
    const snapshot = await ctx.repository.read(r.state.id);
    expect(snapshot.session.startedAt).toEqual(ctx.clock.now());
    expect(snapshot.questions.map((q) => q.status)).toEqual([
      'OPEN',
      'PENDING',
    ]);
  });

  it('la carrera salida/inicio conserva una lista consistente', async () => {
    const r = await room();
    await Promise.allSettled([
      ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id }),
      ctx.rooms.leave(r.player, r.state.id),
    ]);
    const snapshot = await ctx.repository.read(r.state.id);
    if (snapshot.session.status === 'IN_PROGRESS')
      expect(snapshot.participants).toHaveLength(1);
    else {
      expect(snapshot.session.status).toBe('WAITING');
      expect(snapshot.participants).toHaveLength(0);
      expect(snapshot.questions[0].status).toBe('PENDING');
    }
  });

  it.each([15, 30] as const)(
    'cierra a los %i segundos y concede cinco completos de revisión',
    async (duration) => {
      const r = await room(duration);
      await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
      const first = (await ctx.repository.read(r.state.id)).questions[0];
      ctx.clock.advance(duration * 1000 - 1);
      await ctx.deadlines.tick();
      expect((await ctx.rooms.state(r.player, r.state.id)).phase).toBe(
        'ANSWERING',
      );
      ctx.clock.advance(1);
      await ctx.deadlines.tick();
      const advance = {
        sessionId: r.state.id,
        actorId: r.owner.id,
        expectedQuestionId: first.id,
      };
      await expect(ctx.lifecycle.advance(advance)).rejects.toMatchObject({
        code: 'REVIEW_IN_PROGRESS',
      });
      ctx.clock.advance(4_999);
      await ctx.deadlines.tick();
      expect((await ctx.rooms.state(r.player, r.state.id)).currentIndex).toBe(
        0,
      );
      ctx.clock.advance(1);
      await ctx.deadlines.tick();
      expect((await ctx.rooms.state(r.player, r.state.id)).currentIndex).toBe(
        1,
      );
      expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    },
  );

  it('cierra al aceptar todas las respuestas, sin contar al host ni esperar el resto del plazo', async () => {
    const r = await room(30);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(2_000);
    const saved = await answer(r.state.id, r.participant.id);
    await ctx.lifecycle.evaluateAcceptedAnswers({
      sessionId: r.state.id,
      expectedQuestionId: saved.sessionQuestionId,
    });
    const review = await ctx.rooms.state(r.player, r.state.id);
    expect(review.phase).toBe('REVIEW');
    expect(review.currentQuestion!.closedAt).toBe(
      ctx.clock.now().toISOString(),
    );
    expect(
      new Date(review.currentQuestion!.reviewEndsAt!).getTime() -
        ctx.clock.now().getTime(),
    ).toBe(5_000);
    await expect(
      ctx.dataSource.getRepository(Answer).insert({
        sessionQuestionId: saved.sessionQuestionId,
        participantId: r.participant.id,
        choice: false,
        answeredAt: ctx.clock.now(),
        score: 0,
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
  });

  it('ignora la respuesta exactamente tardía y da cero al terminar', async () => {
    const r = await room();
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(15_000);
    const late = await answer(r.state.id, r.participant.id);
    await ctx.lifecycle.evaluateAcceptedAnswers({
      sessionId: r.state.id,
      expectedQuestionId: late.sessionQuestionId,
    });
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    expect((await ctx.rooms.state(r.player, r.state.id)).results).toEqual([
      { participantId: r.participant.id, totalScore: 0, rank: 1 },
    ]);
  });

  it('avance manual y automático concurrentes no saltan preguntas y un plazo viejo es no-op', async () => {
    const r = await room();
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    const first = (await ctx.repository.read(r.state.id)).questions[0];
    ctx.clock.advance(15_000);
    await ctx.deadlines.tick();
    ctx.clock.advance(5_000);
    await Promise.allSettled([
      ctx.lifecycle.advance({
        sessionId: r.state.id,
        actorId: r.owner.id,
        expectedQuestionId: first.id,
      }),
      ctx.deadlines.tick(),
    ]);
    await ctx.lifecycle.processDeadline({
      sessionId: r.state.id,
      expectedQuestionId: first.id,
      kind: 'ANSWER',
      expectedDeadline: first.closesAt!,
    });
    const snapshot = await ctx.repository.read(r.state.id);
    expect(snapshot.session.currentIndex).toBe(1);
    expect(snapshot.questions.map((q) => q.status)).toEqual(['CLOSED', 'OPEN']);
  });

  it('recupera tras reinicio sin host ni socket y sin consumir preguntas nunca presentadas', async () => {
    const r = await room();
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(90_000);
    const restarted = new SessionDeadlinesService(
      ctx.repository,
      ctx.lifecycle,
      ctx.clock,
    );
    try {
      await restarted.onModuleInit();
      const snapshot = await ctx.repository.read(r.state.id);
      expect(snapshot.questions[0].closedAt).toEqual(
        snapshot.questions[0].closesAt,
      );
      expect(snapshot.session.currentIndex).toBe(1);
      expect(snapshot.questions[1].openedAt).toEqual(ctx.clock.now());
      expect(
        snapshot.questions[1].closesAt!.getTime() - ctx.clock.now().getTime(),
      ).toBe(15_000);
    } finally {
      await restarted.onModuleDestroy();
    }
  });

  it('la última revisión finaliza, guarda ceros y libera la reserva sin borrar historial', async () => {
    const r = await room(15, 1);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(15_000);
    await ctx.deadlines.tick();
    ctx.clock.advance(5_000);
    await ctx.deadlines.tick();
    const finished = await ctx.rooms.state(r.player, r.state.id);
    expect(finished.status).toBe('FINISHED');
    expect(finished.currentQuestion).toBeNull();
    expect(finished.results).toEqual([
      { participantId: r.participant.id, totalScore: 0, rank: 1 },
    ]);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(0);
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      1,
    );
    await expect(ctx.rooms.join(r.player, r.state.code)).resolves.toMatchObject(
      { participant: r.participant },
    );
    await expect(
      ctx.rooms.join(ctx.user(), r.state.code),
    ).rejects.toMatchObject({ code: 'SESSION_FINISHED' });
    const next = await room();
    await ctx.rooms.leave(next.player, next.state.id);
    await ctx.rooms.join(r.player, next.state.code);
    expect(await ctx.dataSource.getRepository(SessionParticipant).count()).toBe(
      2,
    );
  });

  it.each(['WAITING', 'ANSWERING', 'REVIEW'])(
    'permite finalizar anticipadamente durante %s y conserva pendientes',
    async (phase) => {
      const r = await room();
      if (phase !== 'WAITING')
        await ctx.lifecycle.start({
          sessionId: r.state.id,
          actorId: r.owner.id,
        });
      if (phase === 'REVIEW') {
        ctx.clock.advance(15_000);
        await ctx.deadlines.tick();
      }
      await ctx.lifecycle.finish({
        sessionId: r.state.id,
        actorId: r.owner.id,
      });
      const snapshot = await ctx.repository.read(r.state.id);
      expect(snapshot.session.status).toBe('FINISHED');
      expect(snapshot.questions[1].status).toBe('PENDING');
      expect(snapshot.session.startedAt === null).toBe(phase === 'WAITING');
      expect(
        await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
      ).toBe(0);
      await expect(
        ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id }),
      ).rejects.toMatchObject({ code: 'SESSION_FINISHED' });
    },
  );

  it('clasifica empates sin host y no cuenta preguntas nunca abiertas', async () => {
    const r = await room();
    const second = await ctx.rooms.join(ctx.user(), r.state.code);
    const third = await ctx.rooms.join(ctx.user(), r.state.code);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(1_000);
    for (const [participantId, score] of [
      [r.participant.id, 100],
      [second.participant.id, 100],
      [third.participant.id, 50],
    ] as const) {
      if (score === 50) ctx.clock.advance(3_000);
      await answer(r.state.id, participantId, score);
    }
    const pending = (await ctx.repository.read(r.state.id)).questions[1];
    await ctx.dataSource.getRepository(Answer).save({
      sessionQuestionId: pending.id,
      participantId: third.participant.id,
      answeredAt: ctx.clock.now(),
      choice: true,
      score: 999,
    });
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    expect(
      (await ctx.rooms.state(r.owner, r.state.id)).results!.map((result) => [
        result.totalScore,
        result.rank,
      ]),
    ).toEqual([
      [3, 1],
      [3, 1],
      [1, 2],
    ]);
  });

  it('finalización y temporizador concurrentes no duplican resultados ni reabren la sala', async () => {
    const r = await room(15, 1);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    ctx.clock.advance(20_000);
    await Promise.allSettled([
      ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id }),
      ctx.deadlines.tick(),
    ]);
    await ctx.deadlines.tick();
    expect((await ctx.rooms.state(r.player, r.state.id)).status).toBe(
      'FINISHED',
    );
    expect(await ctx.dataSource.getRepository(GameResult).count()).toBe(1);
  });

  it('un fallo al persistir revierte estado, resultados y liberación de reserva juntos', async () => {
    const r = await room();
    await ctx.rooms.join(ctx.user(), r.state.code);
    await ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id });
    const opened = await ctx.repository.read(r.state.id);
    await ctx.answers.submit(r.player, {
      sessionQuestionId: opened.questions[0].id,
      choice: true,
    });
    const persist = ctx.repository.persist.bind(ctx.repository);
    jest
      .spyOn(ctx.repository, 'persist')
      .mockImplementationOnce(async (manager, aggregate) => {
        await persist(manager, aggregate);
        throw new Error('Fallo de prueba después de todas las escrituras');
      });
    await expect(
      ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id }),
    ).rejects.toThrow('Fallo de prueba');
    const rolledBack = await ctx.repository.read(r.state.id);
    expect(rolledBack.session.status).toBe('IN_PROGRESS');
    expect(rolledBack.questions[0].status).toBe('OPEN');
    expect(rolledBack.questions[0].scoredAt).toBeNull();
    expect(rolledBack.answers[0].score).toBe(0);
    expect(await ctx.dataSource.getRepository(GameResult).count()).toBe(0);
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(2);
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    expect(
      (await ctx.repository.read(r.state.id)).results.map(
        (row) => row.totalScore,
      ),
    ).toEqual([3, 0]);
  });

  it('dos salas aíslan jugadores, respuestas, plazos, índices y resultados', async () => {
    const first = await room(15);
    const second = await room(30);
    await Promise.all(
      [first, second].map((r) =>
        ctx.lifecycle.start({ sessionId: r.state.id, actorId: r.owner.id }),
      ),
    );
    ctx.clock.advance(1_000);
    const saved = await answer(first.state.id, first.participant.id);
    await ctx.lifecycle.evaluateAcceptedAnswers({
      sessionId: second.state.id,
      expectedQuestionId: saved.sessionQuestionId,
    });
    expect((await ctx.rooms.state(second.player, second.state.id)).phase).toBe(
      'ANSWERING',
    );
    await expect(
      ctx.rooms.join(first.player, second.state.code),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_JOINABLE' });
    ctx.clock.advance(14_000);
    await ctx.deadlines.tick();
    expect((await ctx.rooms.state(second.player, second.state.id)).phase).toBe(
      'ANSWERING',
    );
    await ctx.lifecycle.finish({
      sessionId: first.state.id,
      actorId: first.owner.id,
    });
    const firstState = await ctx.rooms.state(first.player, first.state.id);
    const secondState = await ctx.rooms.state(second.player, second.state.id);
    expect(firstState.results![0].totalScore).toBe(3);
    expect(secondState.results).toBeNull();
    expect(secondState.participants.map((p) => p.userId)).toEqual([
      second.player.id,
    ]);
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(1);
  });
});
