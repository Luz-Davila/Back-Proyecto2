import { randomUUID } from 'crypto';
import type { QueryRunner } from 'typeorm';
import { InitialSchema1792985508587 } from '../../src/database/migrations/1792985508587-InitialSchema';
import { AddSessionLifecycle1793158800000 } from '../../src/database/migrations/1793158800000-AddSessionLifecycle';
import { createSessionTestDataSource } from '../support/session-test-database';

describe('Migración de sesiones en PostgreSQL de pruebas', () => {
  const dataSource = createSessionTestDataSource();
  const migration = new AddSessionLifecycle1793158800000();
  let runner: QueryRunner;
  let schema: string;

  beforeAll(async () => {
    await dataSource.initialize();
  });

  beforeEach(async () => {
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    schema = `session_migration_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}", public`);
    await new InitialSchema1792985508587().up(runner);
  });

  afterEach(async () => {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner && !runner.isReleased) await runner.release();
  });

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  async function legacySession(
    status = 'WAITING',
    playerId = randomUUID(),
    hostId = randomUUID(),
  ) {
    await runner.query(
      'INSERT INTO profiles("userId", "displayName") VALUES ($1, $3), ($2, $3) ON CONFLICT DO NOTHING',
      [hostId, playerId, 'Prueba'],
    );
    const [{ id }] = (await runner.query(
      `INSERT INTO game_sessions(code, "hostId", "quizTitle", status)
       VALUES ($1, $2, 'Prueba', $3) RETURNING id`,
      [randomUUID().slice(0, 8), hostId, status],
    )) as Array<{ id: string }>;
    const [participant] = (await runner.query(
      `INSERT INTO session_participants("sessionId", "userId", "displayName")
       VALUES ($1, $2, 'Prueba') RETURNING id`,
      [id, playerId],
    )) as Array<{ id: string }>;
    return { id, playerId, participantId: participant.id };
  }

  it('migra desde esquema limpio y crea la reserva con RLS y duración restringida', async () => {
    await migration.up(runner);
    const tables = (await runner.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
      [schema],
    )) as Array<{ table_name: string }>;
    expect(tables).toHaveLength(9);
    const [rls] = (await runner.query(
      `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'active_session_memberships'`,
      [schema],
    )) as Array<{ relrowsecurity: boolean }>;
    expect(rls.relrowsecurity).toBe(true);

    const room = await legacySession();
    const [duration] = (await runner.query(
      'SELECT "questionDurationSeconds" FROM game_sessions WHERE id = $1',
      [room.id],
    )) as Array<{ questionDurationSeconds: number }>;
    expect(duration.questionDurationSeconds).toBe(30);
    await expect(
      runner.query(
        'UPDATE game_sessions SET "questionDurationSeconds" = 20 WHERE id = $1',
        [room.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rellena solo reservas de espera y conserva historial al revertir', async () => {
    const playerId = randomUUID();
    const waiting = await legacySession('WAITING', playerId);
    const finished = await legacySession('FINISHED', playerId);
    await runner.query(
      'INSERT INTO game_results("sessionId", "participantId", "totalScore", rank) VALUES ($1, $2, 42, 1)',
      [finished.id, finished.participantId],
    );
    await migration.up(runner);
    expect(
      await runner.query(
        'SELECT "userId", "sessionId" FROM active_session_memberships',
      ),
    ).toEqual([{ userId: playerId, sessionId: waiting.id }]);
    await migration.down(runner);
    const [counts] = (await runner.query(`SELECT
      (SELECT count(*)::int FROM game_sessions) AS rooms,
      (SELECT count(*)::int FROM session_participants) AS players,
      (SELECT "totalScore" FROM game_results LIMIT 1) AS score`)) as Array<{
      rooms: number;
      players: number;
      score: number;
    }>;
    expect(counts).toEqual({ rooms: 2, players: 2, score: 42 });
    expect(
      await runner.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        [schema],
      ),
    ).toHaveLength(8);
  });

  it.each(['IN_PROGRESS', 'HOST_PLAYER', 'MULTIPLE_ROOMS'])(
    'aborta sin cambiar datos ante %s',
    async (conflict) => {
      if (conflict === 'IN_PROGRESS') await legacySession('IN_PROGRESS');
      if (conflict === 'HOST_PLAYER') {
        const hostId = randomUUID();
        await legacySession('WAITING', hostId, hostId);
      }
      if (conflict === 'MULTIPLE_ROOMS') {
        const playerId = randomUUID();
        await legacySession('WAITING', playerId);
        await legacySession('WAITING', playerId);
      }
      const before = await runner.query(
        'SELECT * FROM session_participants ORDER BY id',
      );
      await expect(migration.up(runner)).rejects.toThrow('Preflight');
      expect(
        await runner.query('SELECT * FROM session_participants ORDER BY id'),
      ).toEqual(before);
      expect(
        await runner.query(
          `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND column_name = 'questionDurationSeconds'`,
          [schema],
        ),
      ).toEqual([]);
    },
  );

  it('revierte todos los cambios del intento si falla un DDL', async () => {
    await runner.query(
      'ALTER TABLE session_questions ADD COLUMN "closedAt" timestamptz',
    );
    await runner.query('SAVEPOINT migration_attempt');
    await expect(migration.up(runner)).rejects.toMatchObject({ code: '42701' });
    await runner.query('ROLLBACK TO SAVEPOINT migration_attempt');
    expect(
      await runner.query(
        `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND column_name = 'questionDurationSeconds'`,
        [schema],
      ),
    ).toEqual([]);
  });
});
