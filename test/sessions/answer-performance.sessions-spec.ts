import { SessionCoordinator } from '../../src/sessions/session-coordinator';
import { Answer } from '../../src/sessions/answer.entity';
import { SessionParticipant } from '../../src/sessions/session-participant.entity';
import { SessionNotifications } from '../../src/sessions/session-notifications';
import {
  createSessionTestContext,
  type SessionTestContext,
} from '../support/session-test-context';

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Regresión: respuestas sin amplificación de historial', () => {
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

  async function room(players = 2) {
    const { owner, quiz } = await ctx.seedQuiz(2);
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: 30,
      reviewDurationSeconds: 3,
    });
    const users = Array.from({ length: players }, () => ctx.user());
    await Promise.all(users.map((user) => ctx.rooms.join(user, state.code)));
    await ctx.lifecycle.start({ sessionId: state.id, actorId: owner.id });
    const snapshot = await ctx.repository.read(state.id);
    return {
      owner,
      state,
      users,
      snapshot,
      input: { sessionQuestionId: snapshot.questions[0].id, choice: true },
    };
  }

  it('usa cero snapshots completos para respuesta intermedia y replay', async () => {
    const r = await room();
    const snapshot = jest.spyOn(ctx.repository, 'snapshot');
    const first = await ctx.answers.submit(r.users[0], r.input);
    expect(snapshot).not.toHaveBeenCalled();
    await expect(ctx.answers.submit(r.users[0], r.input)).resolves.toEqual(
      first,
    );
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('limita cada envío normal a cinco consultas y replay a cuatro, incluido enrutamiento', async () => {
    const r = await room();
    const createRunner = ctx.dataSource.createQueryRunner.bind(ctx.dataSource);
    const sql: string[] = [];
    jest
      .spyOn(ctx.dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        const runner = createRunner(...args);
        const original = runner.query.bind(runner);
        runner.query = ((statement: string, ...rest: unknown[]) => {
          sql.push(statement);
          return original(statement, ...rest);
        }) as typeof runner.query;
        return runner;
      });
    await ctx.answers.submit(r.users[0], r.input);
    expect(sql).toHaveLength(5); // routing + BEGIN/select/CTE/COMMIT
    sql.length = 0;
    await ctx.answers.submit(r.users[0], r.input);
    expect(sql).toHaveLength(4); // routing + BEGIN/select/COMMIT
    expect(
      sql.some((statement) =>
        /^(?:\s*WITH|\s*INSERT|\s*UPDATE|\s*DELETE)/i.test(statement),
      ),
    ).toBe(false);
  });

  it('no cuenta host, respuestas de otra sala ni filas fuera de ventana', async () => {
    const r = await room();
    const other = await room();
    const host = await ctx.dataSource
      .getRepository(SessionParticipant)
      .save({ sessionId: r.state.id, userId: r.owner.id, displayName: 'Host' });
    const foreign = (await ctx.repository.read(other.state.id)).participants[0];
    const local = r.snapshot.participants.find(
      (p) => p.userId === r.users[1].id,
    )!;
    await ctx.dataSource.getRepository(Answer).save([
      {
        ...r.input,
        participantId: host.id,
        answeredAt: ctx.clock.now(),
        score: 0,
      },
      {
        ...r.input,
        participantId: foreign.id,
        answeredAt: ctx.clock.now(),
        score: 0,
      },
      {
        ...r.input,
        participantId: local.id,
        answeredAt: new Date(ctx.clock.now().getTime() - 1),
        score: 0,
      },
    ]);
    await ctx.answers.submit(r.users[0], r.input);
    expect((await ctx.repository.read(r.state.id)).questions[0].status).toBe(
      'OPEN',
    );
  });

  it('fallar durante el lote revierte la última respuesta sin notificación confirmada', async () => {
    const r = await room(1);
    const createRunner = ctx.dataSource.createQueryRunner.bind(ctx.dataSource);
    const committed = jest.spyOn(
      ctx.app.get(SessionNotifications),
      'committed',
    );
    let batchReached = false;
    jest
      .spyOn(ctx.dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        const runner = createRunner(...args);
        const original = runner.query.bind(runner);
        runner.query = (async (sql: string, ...rest: unknown[]) => {
          const value: unknown = await original(sql, ...rest);
          if (/UPDATE\s+(?:"[^"]+"\.)?"answers"/i.test(sql)) {
            batchReached = true;
            throw new Error('batch failure');
          }
          return value;
        }) as typeof runner.query;
        return runner;
      });
    await expect(ctx.answers.submit(r.users[0], r.input)).rejects.toThrow(
      'batch failure',
    );
    expect(batchReached).toBe(true);
    expect(committed).not.toHaveBeenCalled();
    const after = await ctx.repository.read(r.state.id);
    expect(after.answers).toEqual([]);
    expect(after.questions[0].status).toBe('OPEN');
    expect(after.questions[0].scoredAt).toBeNull();
  });

  it('conserva la admisión anterior al plazo aunque espere detrás de otro trabajo', async () => {
    const r = await room();
    const entered = gate();
    const blocked = gate();
    const holding = ctx.app
      .get(SessionCoordinator)
      .run(r.state.id, async () => {
        entered.release();
        await blocked.promise;
      });
    await entered.promise;
    const admittedAt = ctx.clock.now().toISOString();
    const pending = ctx.answers.submit(r.users[0], r.input);
    // Observe a rejection immediately as well, so the pre-change red test has no
    // unhandled rejection while the fixture clock is advanced.
    const result = pending.then(
      (value) => ({ value }),
      (error) => ({ error: error as Error }),
    );
    ctx.clock.advance(30_001);
    const deadline = ctx.lifecycle.processDeadline({
      sessionId: r.state.id,
      expectedQuestionId: r.input.sessionQuestionId,
      kind: 'ANSWER',
      expectedDeadline: r.snapshot.questions[0].closesAt!,
    });
    blocked.release();
    await holding;
    const outcome = await result;
    expect(outcome).toHaveProperty('value.answeredAt', admittedAt);
    await deadline;
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    const [saved] = await ctx.dataSource.getRepository(Answer).find();
    expect(saved.score).toBe(3); // rapidez de admisión, no de procesamiento
  });

  it('espera resolución demorada antes del deadline, libera rechazos y no bloquea otra sala', async () => {
    const r = await room();
    const other = await room();
    const route = ctx.repository.sessionForQuestion.bind(ctx.repository);
    const entered = gate();
    const blocked = gate();
    jest
      .spyOn(ctx.repository, 'sessionForQuestion')
      .mockImplementationOnce(async (id) => {
        entered.release();
        await blocked.promise;
        return route(id);
      });
    const unauthorized = ctx.answers
      .submit(ctx.user(), r.input)
      .catch((error: unknown) => error);
    await entered.promise;
    ctx.clock.advance(29_999);
    const earlyAt = ctx.clock.now().toISOString();
    const accepted = ctx.answers.submit(r.users[0], r.input);
    await expect(
      ctx.answers.submit(other.users[0], other.input),
    ).resolves.toBeDefined();
    ctx.clock.advance(1);
    const exact = ctx.answers
      .submit(r.users[1], r.input)
      .catch((error: unknown) => error);
    const command = {
      sessionId: r.state.id,
      expectedQuestionId: r.input.sessionQuestionId,
      kind: 'ANSWER' as const,
      expectedDeadline: r.snapshot.questions[0].closesAt!,
    };
    const deadlines = [
      ctx.lifecycle.processDeadline(command),
      ctx.lifecycle.processDeadline(command),
    ];
    blocked.release();
    expect(await unauthorized).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await expect(accepted).resolves.toMatchObject({ answeredAt: earlyAt });
    expect(await exact).toMatchObject({ code: 'ANSWER_TOO_LATE' });
    await Promise.all(deadlines);
    const after = await ctx.repository.read(r.state.id);
    expect(after.answers).toHaveLength(1);
    expect(after.questions[0].closedAt).toEqual(
      r.snapshot.questions[0].closesAt,
    );
    expect(after.questions[0].status).toBe('CLOSED');
  });

  it('finish manual puede ganar a una admisión aún resolviendo sala', async () => {
    const r = await room();
    const route = ctx.repository.sessionForQuestion.bind(ctx.repository);
    const entered = gate();
    const blocked = gate();
    jest
      .spyOn(ctx.repository, 'sessionForQuestion')
      .mockImplementationOnce(async (id) => {
        entered.release();
        await blocked.promise;
        return route(id);
      });
    const pending = ctx.answers
      .submit(r.users[0], r.input)
      .catch((error: unknown) => error);
    await entered.promise;
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    blocked.release();
    expect(await pending).toMatchObject({ code: 'SESSION_FINISHED' });
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
  });

  it('29→30 cierra en un lote incluso con cero puntos y sin snapshots intermedios', async () => {
    const r = await room(30);
    const snapshot = jest.spyOn(ctx.repository, 'snapshot');
    await Promise.all(
      r.users
        .slice(0, 29)
        .map((user) => ctx.answers.submit(user, { ...r.input, choice: false })),
    );
    expect(snapshot).not.toHaveBeenCalled();
    await ctx.answers.submit(r.users[29], { ...r.input, choice: false });
    expect(snapshot).toHaveBeenCalledTimes(1);
    const after = await ctx.repository.read(r.state.id);
    expect(after.questions[0].status).toBe('CLOSED');
    expect(after.questions[0].scoredAt).not.toBeNull();
    expect(after.answers).toHaveLength(30);
    expect(after.answers.every((answer) => answer.score === 0)).toBe(true);
  });

  it('no actualiza puntajes previos al avanzar o finalizar durante revisión', async () => {
    const r = await room(1);
    await ctx.answers.submit(r.users[0], r.input);
    const runnerFactory = ctx.dataSource.createQueryRunner.bind(ctx.dataSource);
    const statements: string[] = [];
    jest
      .spyOn(ctx.dataSource, 'createQueryRunner')
      .mockImplementation((...args) => {
        const runner = runnerFactory(...args);
        const original = runner.query.bind(runner);
        runner.query = ((sql: string, ...rest: unknown[]) => {
          statements.push(sql);
          return original(sql, ...rest);
        }) as typeof runner.query;
        return runner;
      });
    ctx.clock.advance(3000);
    await ctx.deadlines.tick();
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    expect(
      statements.filter((sql) => /UPDATE\s+(?:"[^"]+"\.)?"answers"/i.test(sql)),
    ).toEqual([]);
  });
});
