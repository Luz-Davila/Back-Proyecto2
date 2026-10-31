import { randomUUID } from 'crypto';
import { Answer } from '../../src/sessions/answer.entity';
import { GameResult } from '../../src/sessions/game-result.entity';
import { ActiveSessionMembership } from '../../src/sessions/active-session-membership.entity';
import { SessionNotifications } from '../../src/sessions/session-notifications';
import {
  createSessionTestContext,
  type SessionTestContext,
} from '../support/session-test-context';

describe('Respuestas, concurrencia y puntuación en PostgreSQL', () => {
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

  async function room(players = 2, duration = 30, review = 5) {
    const { owner, quiz } = await ctx.seedQuiz();
    const state = await ctx.rooms.create(owner, {
      quizId: quiz.id,
      questionDurationSeconds: duration,
      reviewDurationSeconds: review,
    });
    const users = Array.from({ length: players }, () => ctx.user());
    const participants = await Promise.all(
      users.map((user) => ctx.rooms.join(user, state.code)),
    );
    await ctx.lifecycle.start({ sessionId: state.id, actorId: owner.id });
    const snapshot = await ctx.repository.read(state.id);
    const input = { sessionQuestionId: snapshot.questions[0].id, choice: true };
    return { owner, state, users, participants, snapshot, input };
  }

  it('dos dispositivos/doble clic devuelven un único registro y comprobante privado', async () => {
    const r = await room();
    ctx.clock.advance(800);
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => ctx.answers.submit(r.users[0], r.input)),
    );
    expect(
      receipts.every(
        (receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0]),
      ),
    ).toBe(true);
    expect(Object.keys(receipts[0]).sort()).toEqual(
      ['id', 'sessionQuestionId', 'choice', 'answeredAt'].sort(),
    );
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    expect((await ctx.repository.read(r.state.id)).questions[0].status).toBe(
      'OPEN',
    );
  });

  it('elecciones opuestas concurrentes no reemplazan la ganadora', async () => {
    const r = await room();
    const outcomes = await Promise.allSettled(
      [true, false].map((choice) =>
        ctx.answers.submit(r.users[0], { ...r.input, choice }),
      ),
    );
    expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(
      (outcomes.find((v) => v.status === 'rejected') as PromiseRejectedResult)
        .reason.code,
    ).toBe('ANSWER_ALREADY_SUBMITTED');
    const [saved] = await ctx.dataSource.getRepository(Answer).find();
    expect(saved.id).toBe(
      (
        outcomes.find(
          (v) => v.status === 'fulfilled',
        ) as PromiseFulfilledResult<{ id: string }>
      ).value.id,
    );
  });

  it('rechaza suplantación de sala, host y pregunta inexistente antes de informar estados', async () => {
    const r = await room();
    await expect(ctx.answers.submit(ctx.user(), r.input)).rejects.toMatchObject(
      { code: 'SESSION_NOT_FOUND' },
    );
    await expect(ctx.answers.submit(r.owner, r.input)).rejects.toMatchObject({
      code: 'HOST_CANNOT_PARTICIPATE',
    });
    await expect(
      ctx.answers.submit(r.users[0], {
        ...r.input,
        sessionQuestionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    const other = await room();
    await expect(
      ctx.answers.submit(r.users[0], other.input),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
  });

  it('rechaza futura y exactamente tardía sin esperar al worker', async () => {
    const r = await room(2, 5);
    await expect(
      ctx.answers.submit(r.users[0], {
        ...r.input,
        sessionQuestionId: r.snapshot.questions[1].id,
      }),
    ).rejects.toMatchObject({ code: 'QUESTION_NOT_OPEN' });
    ctx.clock.advance(5000);
    await expect(ctx.answers.submit(r.users[0], r.input)).rejects.toMatchObject(
      { code: 'ANSWER_TOO_LATE' },
    );
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    expect((await ctx.repository.read(r.state.id)).questions[0].status).toBe(
      'OPEN',
    );
  });

  it('última respuesta cierra/puntúa, reintenta después de revisión y fin sin sumar otra vez', async () => {
    const r = await room(2, 30, 3);
    ctx.clock.advance(800);
    const first = await ctx.answers.submit(r.users[0], r.input);
    ctx.clock.advance(700);
    await ctx.answers.submit(r.users[1], r.input);
    let snapshot = await ctx.repository.read(r.state.id);
    expect(snapshot.questions[0].status).toBe('CLOSED');
    expect(snapshot.answers.map((a) => a.score).sort()).toEqual([1, 3]);
    expect(
      snapshot.questions[0].reviewEndsAt!.getTime() -
        snapshot.questions[0].closedAt!.getTime(),
    ).toBe(3000);
    await expect(ctx.answers.submit(r.users[0], r.input)).resolves.toEqual(
      first,
    );
    ctx.clock.advance(3000);
    await ctx.deadlines.tick();
    await expect(ctx.answers.submit(r.users[0], r.input)).resolves.toEqual(
      first,
    );
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    snapshot = await ctx.repository.read(r.state.id);
    const results = snapshot.results;
    await expect(ctx.answers.submit(r.users[0], r.input)).resolves.toEqual(
      first,
    );
    await expect(
      ctx.answers.submit(r.users[0], { ...r.input, choice: false }),
    ).rejects.toMatchObject({ code: 'ANSWER_ALREADY_SUBMITTED' });
    expect((await ctx.repository.read(r.state.id)).results).toEqual(results);
    expect(results.map((r) => r.totalScore)).toEqual([3, 1]);
  });

  it('nueva respuesta en FINISHED antes del deadline no se acepta', async () => {
    const r = await room();
    await ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id });
    await expect(ctx.answers.submit(r.users[0], r.input)).rejects.toMatchObject(
      { code: 'SESSION_FINISHED' },
    );
  });

  it('respuesta/worker y finish/worker concurrentes producen un cierre y resultados únicos', async () => {
    const r = await room(1, 5);
    ctx.clock.advance(5000);
    await Promise.allSettled([
      ctx.answers.submit(r.users[0], r.input),
      ctx.deadlines.tick(),
    ]);
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(0);
    ctx.clock.advance(5000);
    await Promise.allSettled([
      ctx.lifecycle.finish({ sessionId: r.state.id, actorId: r.owner.id }),
      ctx.deadlines.tick(),
    ]);
    expect((await ctx.repository.read(r.state.id)).session.status).toBe(
      'FINISHED',
    );
    expect(await ctx.dataSource.getRepository(GameResult).count()).toBe(1);
  });

  it('fallo al persistir la última respuesta revierte Answer, cierre y scores juntos', async () => {
    const r = await room(1);
    const persist = ctx.repository.persist.bind(ctx.repository);
    jest
      .spyOn(ctx.repository, 'persist')
      .mockImplementationOnce(async (manager, aggregate) => {
        await persist(manager, aggregate);
        throw new Error('rollback after scores');
      });
    await expect(ctx.answers.submit(r.users[0], r.input)).rejects.toThrow(
      'rollback after scores',
    );
    const after = await ctx.repository.read(r.state.id);
    expect(after.answers).toEqual([]);
    expect(after.questions[0].status).toBe('OPEN');
    expect(after.questions[0].scoredAt).toBeNull();
    expect(
      await ctx.dataSource.getRepository(ActiveSessionMembership).count(),
    ).toBe(1);
    await ctx.answers.submit(r.users[0], r.input);
    expect((await ctx.repository.read(r.state.id)).questions[0].status).toBe(
      'CLOSED',
    );
  });

  it('colisión única se recupera en transacción nueva; otros errores no se disfrazan', async () => {
    const r = await room();
    const observed = jest.spyOn(ctx.telemetry, 'answer');
    const snapshot: typeof ctx.repository.snapshot =
      ctx.repository.snapshot.bind(ctx.repository);
    const locked = jest.spyOn(ctx.repository, 'locked');
    let winner!: Answer;
    // After the in-transaction duplicate check, a writer using an independent
    // pooled connection bypasses the room protocol. The next INSERT really
    // violates PostgreSQL uniqueness and aborts our first transaction.
    jest
      .spyOn(ctx.repository, 'snapshot')
      .mockImplementationOnce(snapshot)
      .mockImplementationOnce(async (manager, session) => {
        const aggregate = await snapshot(manager, session);
        winner = await ctx.dataSource.getRepository(Answer).save({
          ...r.input,
          participantId: r.participants[0].participant.id,
          answeredAt: ctx.clock.now(),
          score: 0,
        });
        return aggregate;
      });
    const receipt = await ctx.answers.submit(r.users[0], r.input);
    expect(receipt).toMatchObject({ id: winner.id, choice: true });
    expect(locked).toHaveBeenCalledTimes(2);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalledWith('replayed');
    expect(await ctx.dataSource.getRepository(Answer).count()).toBe(1);
    locked.mockRejectedValueOnce(new Error('unrelated'));
    await expect(ctx.answers.submit(r.users[1], r.input)).rejects.toThrow(
      'unrelated',
    );
  });

  it('respuesta intermedia y reintentos no cambian secuencia pública', async () => {
    const r = await room();
    const notifications = ctx.app.get(SessionNotifications);
    const before = notifications.current(
      await ctx.repository.read(r.state.id),
    ).position;
    await ctx.answers.submit(r.users[0], r.input);
    await ctx.answers.submit(r.users[0], r.input);
    expect(
      notifications.current(await ctx.repository.read(r.state.id)).position,
    ).toEqual(before);
    await ctx.answers.submit(r.users[1], { ...r.input, choice: false });
    expect(
      notifications.current(await ctx.repository.read(r.state.id)).position
        .sequence,
    ).toBe(before.sequence + 1);
  });
});
