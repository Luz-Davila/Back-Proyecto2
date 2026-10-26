import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from '../../src/database/database.options';

const databaseUrl = process.env.DATABASE_URL;
const runSuite = Boolean(databaseUrl);

/**
 * Pruebas de integración contra el PostgreSQL configurado en DATABASE_URL.
 * Cada prueba corre dentro de una transacción que se revierte al final,
 * así la base no conserva datos de prueba.
 */
(runSuite ? describe : describe.skip)('Esquema en PostgreSQL', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(
      buildDatabaseOptions(databaseUrl as string, process.env.DATABASE_SSL === 'true'),
    );
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('BEGIN');
  });

  afterEach(async () => {
    await dataSource.query('ROLLBACK');
  });

  async function createSession() {
    const userId = (await dataSource.query('SELECT gen_random_uuid() AS id'))[0].id;
    await dataSource.query('INSERT INTO profiles("userId","displayName") VALUES ($1,$2)', [
      userId,
      'Prueba integración',
    ]);
    const quizId = (
      await dataSource.query('INSERT INTO quizzes("ownerId",title) VALUES ($1,$2) RETURNING id', [
        userId,
        'Quiz de integración',
      ])
    )[0].id;
    const questionId = (
      await dataSource.query(
        `INSERT INTO questions("quizId",statement,"correctBoolean",position)
         VALUES ($1,'Enunciado',true,0) RETURNING id`,
        [quizId],
      )
    )[0].id;
    const sessionId = (
      await dataSource.query(
        `INSERT INTO game_sessions(code,"quizId","hostId","quizTitle")
         VALUES ($1,$2,$3,'Quiz de integración') RETURNING id`,
        [`IT${Date.now().toString().slice(-6)}`, quizId, userId],
      )
    )[0].id;
    const sessionQuestionId = (
      await dataSource.query(
        `INSERT INTO session_questions("sessionId","originalQuestionId",position,statement,"correctBoolean")
         VALUES ($1,$2,0,'Enunciado',true) RETURNING id`,
        [sessionId, questionId],
      )
    )[0].id;
    const participantId = (
      await dataSource.query(
        `INSERT INTO session_participants("sessionId","userId","displayName")
         VALUES ($1,$2,'Prueba integración') RETURNING id`,
        [sessionId, userId],
      )
    )[0].id;

    return { userId, quizId, questionId, sessionId, sessionQuestionId, participantId };
  }

  it('rechaza dos respuestas del mismo participante a la misma pregunta', async () => {
    const { sessionQuestionId, participantId } = await createSession();
    const insert = `INSERT INTO answers("sessionQuestionId","participantId",choice,"answeredAt")
                    VALUES ($1,$2,true,now())`;

    await dataSource.query(insert, [sessionQuestionId, participantId]);
    await expect(dataSource.query(insert, [sessionQuestionId, participantId])).rejects.toMatchObject(
      { code: '23505' },
    );
  });

  it('rechaza dos participantes con el mismo usuario en una sesión', async () => {
    const { sessionId, userId } = await createSession();
    const insert = `INSERT INTO session_participants("sessionId","userId","displayName")
                    VALUES ($1,$2,'Duplicado')`;

    await expect(dataSource.query(insert, [sessionId, userId])).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('conserva la copia de la pregunta al borrar el cuestionario original', async () => {
    const { quizId, sessionQuestionId, sessionId } = await createSession();

    await dataSource.query('DELETE FROM quizzes WHERE id = $1', [quizId]);

    const copy = (
      await dataSource.query(
        'SELECT statement, "originalQuestionId" FROM session_questions WHERE id = $1',
        [sessionQuestionId],
      )
    )[0];
    const session = (
      await dataSource.query('SELECT "quizId", "quizTitle" FROM game_sessions WHERE id = $1', [
        sessionId,
      ])
    )[0];

    expect(copy.statement).toBe('Enunciado');
    expect(copy.originalQuestionId).toBeNull();
    expect(session.quizId).toBeNull();
    expect(session.quizTitle).toBe('Quiz de integración');
  });

  it('borra participantes y respuestas al eliminar la sesión', async () => {
    const { sessionId, sessionQuestionId, participantId } = await createSession();
    await dataSource.query(
      `INSERT INTO answers("sessionQuestionId","participantId",choice,"answeredAt")
       VALUES ($1,$2,false,now())`,
      [sessionQuestionId, participantId],
    );

    await dataSource.query('DELETE FROM game_sessions WHERE id = $1', [sessionId]);

    const participants = await dataSource.query(
      'SELECT count(*)::int AS n FROM session_participants WHERE id = $1',
      [participantId],
    );
    const answers = await dataSource.query(
      'SELECT count(*)::int AS n FROM answers WHERE "participantId" = $1',
      [participantId],
    );

    expect(participants[0].n).toBe(0);
    expect(answers[0].n).toBe(0);
  });

  it('tiene RLS activo en las tablas de la aplicación', async () => {
    const tables = [
      'profiles',
      'quizzes',
      'questions',
      'game_sessions',
      'session_questions',
      'session_participants',
      'game_results',
      'answers',
    ];

    const result = await dataSource.query(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relkind = 'r' AND relname = ANY($1)`,
      [tables],
    );

    expect(result).toHaveLength(tables.length);
    expect(result.every((row: { relrowsecurity: boolean }) => row.relrowsecurity)).toBe(true);
  });
});
