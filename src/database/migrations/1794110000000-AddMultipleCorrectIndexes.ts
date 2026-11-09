import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultipleCorrectIndexes1794110000000 implements MigrationInterface {
  name = 'AddMultipleCorrectIndexes1794110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['questions', 'session_questions'] as const) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD "correctIndexes" jsonb`);
      await queryRunner.query(`
        UPDATE "${table}"
        SET "correctIndexes" = CASE
          WHEN "correctIndex" IS NULL THEN NULL
          ELSE jsonb_build_array("correctIndex")
        END
      `);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "correctIndex"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['questions', 'session_questions'] as const) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD "correctIndex" smallint`);
      await queryRunner.query(`
        UPDATE "${table}"
        SET "correctIndex" = CASE
          WHEN jsonb_typeof("correctIndexes") = 'array'
            THEN (("correctIndexes" ->> 0)::smallint)
          ELSE NULL
        END
      `);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "correctIndexes"`);
    }
  }
}
