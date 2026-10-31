import { randomUUID } from 'crypto';
import type { QueryRunner } from 'typeorm';
import { InitialSchema1792985508587 } from '../../src/database/migrations/1792985508587-InitialSchema';
import { AddSessionLifecycle1793158800000 } from '../../src/database/migrations/1793158800000-AddSessionLifecycle';
import { AddAnswersScoringAndTiming1793318400000 } from '../../src/database/migrations/1793318400000-AddAnswersScoringAndTiming';
import { createSessionTestDataSource } from '../support/session-test-database';

describe('Migración de puntuación y tiempos en PostgreSQL', () => {
  const ds = createSessionTestDataSource();
  const migration = new AddAnswersScoringAndTiming1793318400000();
  let runner: QueryRunner;
  beforeAll(async () => {
    await ds.initialize();
  });
  beforeEach(async () => {
    runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const schema = `scoring_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}", public`);
    await new InitialSchema1792985508587().up(runner);
    await new AddSessionLifecycle1793158800000().up(runner);
  });
  afterEach(async () => {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  });
  afterAll(async () => {
    if (ds.isInitialized) await ds.destroy();
  });

  async function seed(
    status = 'WAITING',
    questionStatus = 'PENDING',
    withAnswer = false,
  ) {
    const host = randomUUID(),
      player = randomUUID();
    await runner.query(
      'INSERT INTO profiles("userId", "displayName") VALUES ($1,\'Host\'), ($2,\'Jugador\')',
      [host, player],
    );
    const [session] = await runner.query(
      `INSERT INTO game_sessions(code,"hostId","quizTitle",status) VALUES ($1,$2,'Legacy',$3) RETURNING id`,
      [randomUUID().slice(0, 8), host, status],
    );
    const [question] = await runner.query(
      `INSERT INTO session_questions("sessionId",position,statement,"correctBoolean",status) VALUES ($1,0,'Legacy',true,$2) RETURNING id`,
      [session.id, questionStatus],
    );
    const [participant] = await runner.query(
      `INSERT INTO session_participants("sessionId","userId","displayName") VALUES ($1,$2,'Jugador') RETURNING id`,
      [session.id, player],
    );
    if (withAnswer)
      await runner.query(
        `INSERT INTO answers("sessionQuestionId","participantId",choice,"answeredAt",score) VALUES ($1,$2,true,now(),100)`,
        [question.id, participant.id],
      );
    if (status === 'FINISHED')
      await runner.query(
        `INSERT INTO game_results("sessionId","participantId","totalScore",rank) VALUES ($1,$2,100,1)`,
        [session.id, participant.id],
      );
    return session.id as string;
  }

  it('backfill conserva scores, resultados y respuesta 30; down conserva historial', async () => {
    const id = await seed('FINISHED', 'CLOSED', true);
    const answers = await runner.query('SELECT * FROM answers');
    const results = await runner.query('SELECT * FROM game_results');
    await migration.up(runner);
    expect(await runner.query('SELECT * FROM answers')).toEqual(answers);
    expect(await runner.query('SELECT * FROM game_results')).toEqual(results);
    expect(
      (
        await runner.query(
          'SELECT "questionDurationSeconds", "reviewDurationSeconds" FROM game_sessions WHERE id=$1',
          [id],
        )
      )[0],
    ).toEqual({ questionDurationSeconds: 30, reviewDurationSeconds: 5 });
    expect(
      (await runner.query('SELECT "scoredAt" FROM session_questions'))[0]
        .scoredAt,
    ).toBeInstanceOf(Date);
    await migration.down(runner);
    expect(await runner.query('SELECT * FROM answers')).toEqual(answers);
    expect(await runner.query('SELECT * FROM game_results')).toEqual(results);
  });

  it.each(['IN_PROGRESS', 'OPEN', 'ANSWER'])(
    'preflight aborta sin DDL ante %s',
    async (kind) => {
      await seed(
        kind === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'WAITING',
        kind === 'OPEN' ? 'OPEN' : 'PENDING',
        kind === 'ANSWER',
      );
      const before = await runner.query('SELECT * FROM game_sessions');
      await expect(migration.up(runner)).rejects.toThrow('Preflight');
      expect(await runner.query('SELECT * FROM game_sessions')).toEqual(before);
      expect(
        await runner.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='reviewDurationSeconds'`,
        ),
      ).toEqual([]);
    },
  );

  it.each([
    ['questionDurationSeconds', 4],
    ['questionDurationSeconds', 121],
    ['reviewDurationSeconds', 2],
    ['reviewDurationSeconds', 16],
  ])('CHECK rechaza %s=%i', async (column, value) => {
    await seed();
    await migration.up(runner);
    await expect(
      runner.query(`UPDATE game_sessions SET "${column}"=$1`, [value]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('acepta rangos nuevos y down no convierte duración custom', async () => {
    await seed();
    await migration.up(runner);
    await runner.query(
      'UPDATE game_sessions SET "questionDurationSeconds"=120,"reviewDurationSeconds"=15',
    );
    await expect(migration.down(runner)).rejects.toThrow('incompatibles');
    expect(
      (
        await runner.query(
          'SELECT "questionDurationSeconds","reviewDurationSeconds" FROM game_sessions',
        )
      )[0],
    ).toEqual({ questionDurationSeconds: 120, reviewDurationSeconds: 15 });
  });

  it('down rechaza una partida en curso sin tocar sus columnas', async () => {
    await seed();
    await migration.up(runner);
    await runner.query(`UPDATE game_sessions SET status='IN_PROGRESS'`);
    await expect(migration.down(runner)).rejects.toThrow('Preflight');
    expect(
      (
        await runner.query('SELECT "reviewDurationSeconds" FROM game_sessions')
      )[0].reviewDurationSeconds,
    ).toBe(5);
  });

  it('rollback revierte DDL parcial cuando falla un intento', async () => {
    await seed();
    await runner.query(
      'ALTER TABLE session_questions ADD COLUMN "scoredAt" timestamptz',
    );
    await runner.query('SAVEPOINT attempt');
    await expect(migration.up(runner)).rejects.toMatchObject({ code: '42701' });
    await runner.query('ROLLBACK TO SAVEPOINT attempt');
    expect(
      await runner.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='reviewDurationSeconds'`,
      ),
    ).toEqual([]);
  });
});
