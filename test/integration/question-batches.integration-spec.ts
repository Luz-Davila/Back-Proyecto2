import { randomUUID } from 'node:crypto';
import { ProfilesService } from '../../src/profiles/profiles.service';
import { Profile } from '../../src/profiles/profile.entity';
import { Question } from '../../src/quizzes/question.entity';
import { Quiz } from '../../src/quizzes/quiz.entity';
import { QuestionsService } from '../../src/quizzes/questions.service';
import { QuestionBatchesService } from '../../src/quizzes/question-batches.service';
import { QuestionBatchOperation } from '../../src/quizzes/question-batch-operation.entity';
import { AddQuestionBatchOperations1794096000000 } from '../../src/database/migrations/1794096000000-AddQuestionBatchOperations';
import {
  createSessionTestContext,
  type SessionTestContext,
} from '../support/session-test-context';

describe('Lotes en PostgreSQL aislado', () => {
  let ctx: SessionTestContext;
  let batches: QuestionBatchesService;
  let manual: QuestionsService;
  let profiles: ProfilesService;
  const questions = [
    { statement: 'Afirmación revisada', correctBoolean: false },
    { statement: 'Segunda', correctBoolean: true },
  ];
  beforeAll(async () => {
    ctx = await createSessionTestContext();
    profiles = new ProfilesService(ctx.dataSource.getRepository(Profile));
    batches = new QuestionBatchesService(ctx.dataSource, profiles);
    manual = new QuestionsService(
      ctx.dataSource.getRepository(Question),
      ctx.dataSource.getRepository(Quiz),
      ctx.dataSource,
    );
  });
  afterAll(async () => {
    await ctx?.close();
  });
  beforeEach(async () => {
    await ctx.reset();
  });

  async function seed() {
    const value = await ctx.seedQuiz();
    await ctx.dataSource
      .getRepository(Profile)
      .update({ userId: value.owner.id }, { role: 'teacher' });
    return value;
  }

  it('migra up/down sin tocar preguntas existentes', async () => {
    const { quiz } = await seed();
    const runner = ctx.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const migration = new AddQuestionBatchOperations1794096000000();
      await migration.down(runner);
      await migration.up(runner);
      const rls = (await runner.query(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'question_batch_operations' AND relnamespace = current_schema()::regnamespace`,
      )) as Array<{ relrowsecurity: boolean }>;
      expect(rls[0].relrowsecurity).toBe(true);
      expect(
        await ctx.dataSource
          .getRepository(Question)
          .countBy({ quizId: quiz.id }),
      ).toBe(2);
    } finally {
      await runner.release();
    }
  });

  it('confirma exactamente el contenido y reproduce un recibo durable sin duplicar', async () => {
    const { owner, quiz } = await seed();
    const dto = { operationId: randomUUID(), questions };
    const [a, b] = await Promise.all([
      batches.create(owner, quiz.id, dto),
      batches.create(owner, quiz.id, dto),
    ]);
    expect(a).toEqual(b);
    expect(a.questions.map((q) => q.position)).toEqual([2, 3]);
    expect(a.questions[0]).toMatchObject(questions[0]);
    await ctx.dataSource
      .getRepository(Question)
      .update(a.questions[0].id, { statement: 'Edición posterior' });
    const restarted = new QuestionBatchesService(ctx.dataSource, profiles);
    expect(await restarted.create(owner, quiz.id, dto)).toEqual(a);
    expect(
      await ctx.dataSource.getRepository(Question).countBy({ quizId: quiz.id }),
    ).toBe(4);
    await expect(
      batches.create(owner, quiz.id, { ...dto, questions: [questions[0]] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('revierte todas las preguntas y el recibo ante error intermedio', async () => {
    const { owner, quiz } = await seed();
    // Trigger exclusivo de este esquema de pruebas; provoca un fallo después de la primera inserción.
    await ctx.dataSource.query(
      `CREATE FUNCTION "${ctx.schema}".fail_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.statement = 'FALLAR' THEN RAISE EXCEPTION 'fallo de prueba'; END IF; RETURN NEW; END; $$`,
    );
    await ctx.dataSource.query(
      `CREATE TRIGGER fail_batch BEFORE INSERT ON "${ctx.schema}".questions FOR EACH ROW EXECUTE FUNCTION "${ctx.schema}".fail_batch()`,
    );
    try {
      await expect(
        batches.create(owner, quiz.id, {
          operationId: randomUUID(),
          questions: [
            questions[0],
            { statement: 'FALLAR', correctBoolean: false },
          ],
        }),
      ).rejects.toThrow();
      expect(
        await ctx.dataSource
          .getRepository(Question)
          .countBy({ quizId: quiz.id }),
      ).toBe(2);
      expect(
        await ctx.dataSource.getRepository(QuestionBatchOperation).count(),
      ).toBe(0);
    } finally {
      await ctx.dataSource.query(
        `DROP TRIGGER fail_batch ON "${ctx.schema}".questions`,
      );
      await ctx.dataSource.query(`DROP FUNCTION "${ctx.schema}".fail_batch()`);
    }
  });

  it('coordina lote, inserción, movimiento y eliminación manual concurrentes', async () => {
    const { owner, quiz } = await seed();
    const originals = await ctx.dataSource
      .getRepository(Question)
      .findBy({ quizId: quiz.id });
    await Promise.all([
      batches.create(owner, quiz.id, { operationId: randomUUID(), questions }),
      manual.create(owner, quiz.id, {
        statement: 'Manual',
        correctBoolean: true,
        position: 0,
      }),
      manual.update(owner, originals[1].id, { position: 0 }),
      manual.remove(owner, originals[0].id),
    ]);
    const rows = await ctx.dataSource
      .getRepository(Question)
      .find({ where: { quizId: quiz.id }, order: { position: 'ASC' } });
    expect(rows.map((q) => q.position)).toEqual([0, 1, 2, 3]);
    expect(rows.map((q) => q.statement)).toEqual(
      expect.arrayContaining(['Manual', 'Afirmación revisada', 'Segunda']),
    );
  });

  it('revalida rol y propietario al reproducir una operación', async () => {
    const { owner, quiz } = await seed();
    const dto = { operationId: randomUUID(), questions };
    await batches.create(owner, quiz.id, dto);
    await ctx.dataSource
      .getRepository(Profile)
      .update({ userId: owner.id }, { role: 'student' });
    await expect(batches.create(owner, quiz.id, dto)).rejects.toMatchObject({
      status: 403,
    });
    await ctx.dataSource
      .getRepository(Profile)
      .update({ userId: owner.id }, { role: 'teacher' });
    await expect(
      batches.create(owner, randomUUID(), dto),
    ).rejects.toMatchObject({ status: 404 });
  });
});
