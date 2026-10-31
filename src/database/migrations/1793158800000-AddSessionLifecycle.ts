import type { MigrationInterface, QueryRunner } from 'typeorm';

interface PreflightResult {
  hasInProgress: boolean;
  hasHostParticipant: boolean;
  hasMultipleActiveSessions: boolean;
}

export class AddSessionLifecycle1793158800000 implements MigrationInterface {
  name = 'AddSessionLifecycle1793158800000';

  private requireTransaction(queryRunner: QueryRunner): void {
    if (!queryRunner.isTransactionActive) {
      throw new Error(
        'La migración de sesiones requiere una transacción; usa el modo all o each',
      );
    }
  }

  async up(queryRunner: QueryRunner): Promise<void> {
    this.requireTransaction(queryRunner);
    // Evita escrituras entre el preflight y el backfill, incluso desde el backend anterior.
    await queryRunner.query(
      'LOCK TABLE "game_sessions", "session_participants" IN SHARE ROW EXCLUSIVE MODE',
    );
    const [preflight] = (await queryRunner.query(`
      SELECT
        EXISTS (SELECT 1 FROM "game_sessions" WHERE status = 'IN_PROGRESS') AS "hasInProgress",
        EXISTS (
          SELECT 1 FROM "session_participants" p
          JOIN "game_sessions" s ON s.id = p."sessionId"
          WHERE p."userId" = s."hostId"
        ) AS "hasHostParticipant",
        EXISTS (
          SELECT p."userId" FROM "session_participants" p
          JOIN "game_sessions" s ON s.id = p."sessionId"
          WHERE s.status IN ('WAITING', 'IN_PROGRESS')
          GROUP BY p."userId" HAVING count(*) > 1
        ) AS "hasMultipleActiveSessions"
    `)) as PreflightResult[];

    if (preflight.hasInProgress) {
      throw new Error(
        'Preflight de sesiones: hay partidas heredadas en curso; requiere resolución explícita del operador',
      );
    }
    if (preflight.hasHostParticipant) {
      throw new Error(
        'Preflight de sesiones: existe un host registrado como jugador; no se modificaron sus datos',
      );
    }
    if (preflight.hasMultipleActiveSessions) {
      throw new Error(
        'Preflight de sesiones: un jugador participa en varias salas activas; no se modificaron sus datos',
      );
    }

    await queryRunner.query(`
      ALTER TABLE "game_sessions"
      ADD COLUMN "questionDurationSeconds" integer NOT NULL DEFAULT 30,
      ADD CONSTRAINT "CHK_game_sessions_question_duration" CHECK ("questionDurationSeconds" IN (15, 30))
    `);
    await queryRunner.query(`
      ALTER TABLE "session_questions"
      ADD COLUMN "closedAt" timestamptz,
      ADD COLUMN "reviewEndsAt" timestamptz
    `);
    await queryRunner.query(`
      CREATE TABLE "active_session_memberships" (
        "userId" uuid NOT NULL,
        "sessionId" uuid NOT NULL,
        CONSTRAINT "PK_active_session_memberships" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_active_session_memberships_participant"
          FOREIGN KEY ("sessionId", "userId")
          REFERENCES "session_participants" ("sessionId", "userId") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_active_session_memberships_session" ON "active_session_memberships" ("sessionId")
    `);
    await queryRunner.query(
      'ALTER TABLE "active_session_memberships" ENABLE ROW LEVEL SECURITY',
    );
    await queryRunner.query(`
      INSERT INTO "active_session_memberships" ("userId", "sessionId")
      SELECT p."userId", p."sessionId" FROM "session_participants" p
      JOIN "game_sessions" s ON s.id = p."sessionId"
      WHERE s.status = 'WAITING'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    this.requireTransaction(queryRunner);
    await queryRunner.query(
      'LOCK TABLE "game_sessions", "session_participants" IN SHARE ROW EXCLUSIVE MODE',
    );
    await queryRunner.query('DROP TABLE "active_session_memberships"');
    await queryRunner.query(`
      ALTER TABLE "session_questions" DROP COLUMN "reviewEndsAt", DROP COLUMN "closedAt"
    `);
    await queryRunner.query(`
      ALTER TABLE "game_sessions"
      DROP CONSTRAINT "CHK_game_sessions_question_duration",
      DROP COLUMN "questionDurationSeconds"
    `);
  }
}
