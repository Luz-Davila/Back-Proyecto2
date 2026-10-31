import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnswersScoringAndTiming1793318400000 implements MigrationInterface {
  name = 'AddAnswersScoringAndTiming1793318400000';

  private async lock(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('La migración requiere transacción all o each');
    await runner.query(
      'LOCK TABLE game_sessions, session_questions, answers, game_results IN SHARE ROW EXCLUSIVE MODE',
    );
    const [row] = (await runner.query(
      `SELECT EXISTS(SELECT 1 FROM game_sessions WHERE status = 'IN_PROGRESS') AS active`,
    )) as Array<{ active: boolean }>;
    if (row.active)
      throw new Error(
        'Preflight: hay partidas en curso; detener escrituras y resolverlas antes de migrar',
      );
  }

  async up(runner: QueryRunner): Promise<void> {
    await this.lock(runner);
    const [row] = (await runner.query(`SELECT EXISTS(
      SELECT 1 FROM game_sessions s JOIN session_questions q ON q."sessionId" = s.id
      WHERE s.status = 'WAITING' AND (q.status <> 'PENDING' OR EXISTS(
        SELECT 1 FROM answers a WHERE a."sessionQuestionId" = q.id
      ))
    ) AS dirty`)) as Array<{ dirty: boolean }>;
    if (row.dirty)
      throw new Error(
        'Preflight: sala en espera con preguntas jugadas o respuestas; no se modificaron datos',
      );
    await runner.query(`ALTER TABLE game_sessions
      DROP CONSTRAINT "CHK_game_sessions_question_duration",
      ADD CONSTRAINT "CHK_game_sessions_question_duration" CHECK ("questionDurationSeconds" BETWEEN 5 AND 120),
      ADD COLUMN "reviewDurationSeconds" integer NOT NULL DEFAULT 5,
      ADD CONSTRAINT "CHK_game_sessions_review_duration" CHECK ("reviewDurationSeconds" BETWEEN 3 AND 15)`);
    await runner.query(
      'ALTER TABLE session_questions ADD COLUMN "scoredAt" timestamptz',
    );
    await runner.query(`UPDATE session_questions q SET "scoredAt" = COALESCE(q."closedAt", s."finishedAt", s."createdAt")
      FROM game_sessions s WHERE s.id = q."sessionId" AND s.status = 'FINISHED' AND q.status = 'CLOSED'`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await this.lock(runner);
    const [row] = (await runner.query(`SELECT EXISTS(
      SELECT 1 FROM game_sessions WHERE "questionDurationSeconds" NOT IN (15, 30)
    ) AS custom`)) as Array<{ custom: boolean }>;
    if (row.custom)
      throw new Error(
        'Preflight: hay duraciones incompatibles con 15/30; no se convertirán ni borrarán datos',
      );
    await runner.query(`ALTER TABLE game_sessions
      DROP CONSTRAINT "CHK_game_sessions_question_duration",
      ADD CONSTRAINT "CHK_game_sessions_question_duration" CHECK ("questionDurationSeconds" IN (15, 30)),
      DROP CONSTRAINT "CHK_game_sessions_review_duration", DROP COLUMN "reviewDurationSeconds"`);
    await runner.query('ALTER TABLE session_questions DROP COLUMN "scoredAt"');
  }
}
