import type { DataSource, QueryRunner } from 'typeorm';
import { createSessionTestDataSource } from '../support/session-test-database';

/**
 * PostgreSQL exclusivo de pruebas. BEGIN, consultas y ROLLBACK usan siempre
 * la misma conexión, no conexiones arbitrarias de un pool.
 */
describe('Esquema en PostgreSQL de pruebas', () => {
  let dataSource: DataSource;
  let connection: QueryRunner;

  beforeAll(async () => {
    dataSource = createSessionTestDataSource();
    await dataSource.initialize();
    await dataSource.runMigrations();
    connection = dataSource.createQueryRunner();
    await connection.connect();
  });

  afterAll(async () => {
    if (connection && !connection.isReleased) await connection.release();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await connection.startTransaction();
  });

  afterEach(async () => {
    if (connection?.isTransactionActive) await connection.rollbackTransaction();
  });

  async function createSession() {
    const userId = (await connection.query('SELECT gen_random_uuid() AS id'))[0]
      .id;
    await connection.query(
      'INSERT INTO profiles("userId","displayName") VALUES ($1,$2)',
      [userId, 'Prueba integración'],
    );
    const quizId = (
      await connection.query(
        'INSERT INTO quizzes("ownerId",title) VALUES ($1,$2) RETURNING id',
        [userId, 'Quiz de integración'],
      )
    )[0].id;
    const questionId = (
      await connection.query(
        `INSERT INTO questions("quizId",statement,"correctBoolean",position)
         VALUES ($1,'Enunciado',true,0) RETURNING id`,
        [quizId],
      )
    )[0].id;
    const sessionId = (
      await connection.query(
        `INSERT INTO game_sessions(code,"quizId","hostId","quizTitle")
         VALUES ($1,$2,$3,'Quiz de integración') RETURNING id`,
        [`IT${Date.now().toString().slice(-6)}`, quizId, userId],
      )
    )[0].id;
    const sessionQuestionId = (
      await connection.query(
        `INSERT INTO session_questions("sessionId","originalQuestionId",position,statement,"correctBoolean")
         VALUES ($1,$2,0,'Enunciado',true) RETURNING id`,
        [sessionId, questionId],
      )
    )[0].id;
    const participantId = (
      await connection.query(
        `INSERT INTO session_participants("sessionId","userId","displayName")
         VALUES ($1,$2,'Prueba integración') RETURNING id`,
        [sessionId, userId],
      )
    )[0].id;

    return {
      userId,
      quizId,
      questionId,
      sessionId,
      sessionQuestionId,
      participantId,
    };
  }

  it('rechaza dos respuestas del mismo participante a la misma pregunta', async () => {
    const { sessionQuestionId, participantId } = await createSession();
    const insert = `INSERT INTO answers("sessionQuestionId","participantId",choice,"answeredAt")
                    VALUES ($1,$2,true,now())`;

    await connection.query(insert, [sessionQuestionId, participantId]);
    await expect(
      connection.query(insert, [sessionQuestionId, participantId]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rechaza dos participantes con el mismo usuario en una sesión', async () => {
    const { sessionId, userId } = await createSession();
    const insert = `INSERT INTO session_participants("sessionId","userId","displayName")
                    VALUES ($1,$2,'Duplicado')`;

    await expect(
      connection.query(insert, [sessionId, userId]),
    ).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('conserva la copia de la pregunta al borrar el cuestionario original', async () => {
    const { quizId, sessionQuestionId, sessionId } = await createSession();

    await connection.query('DELETE FROM quizzes WHERE id = $1', [quizId]);

    const copy = (
      await connection.query(
        'SELECT statement, "originalQuestionId" FROM session_questions WHERE id = $1',
        [sessionQuestionId],
      )
    )[0];
    const session = (
      await connection.query(
        'SELECT "quizId", "quizTitle" FROM game_sessions WHERE id = $1',
        [sessionId],
      )
    )[0];

    expect(copy.statement).toBe('Enunciado');
    expect(copy.originalQuestionId).toBeNull();
    expect(session.quizId).toBeNull();
    expect(session.quizTitle).toBe('Quiz de integración');
  });

  it('borra participantes y respuestas al eliminar la sesión', async () => {
    const { sessionId, sessionQuestionId, participantId } =
      await createSession();
    await connection.query(
      `INSERT INTO answers("sessionQuestionId","participantId",choice,"answeredAt")
       VALUES ($1,$2,false,now())`,
      [sessionQuestionId, participantId],
    );

    await connection.query('DELETE FROM game_sessions WHERE id = $1', [
      sessionId,
    ]);

    const participants = await connection.query(
      'SELECT count(*)::int AS n FROM session_participants WHERE id = $1',
      [participantId],
    );
    const answers = await connection.query(
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
      'active_session_memberships',
    ];

    const result = await connection.query(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relkind = 'r' AND relnamespace = current_schema()::regnamespace AND relname = ANY($1)`,
      [tables],
    );

    expect(result).toHaveLength(tables.length);
    expect(
      result.every((row: { relrowsecurity: boolean }) => row.relrowsecurity),
    ).toBe(true);
  });
});
