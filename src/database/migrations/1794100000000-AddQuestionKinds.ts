import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionKinds1794100000000 implements MigrationInterface {
  name = 'AddQuestionKinds1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "questions" ADD "kind" character varying(20) NOT NULL DEFAULT 'boolean'`,
    );
    await queryRunner.query(`ALTER TABLE "questions" ADD "options" jsonb`);
    await queryRunner.query(`ALTER TABLE "questions" ADD "correctIndex" smallint`);
    await queryRunner.query(
      `ALTER TABLE "questions" ADD CONSTRAINT "CHK_questions_kind" CHECK ("kind" IN ('boolean', 'multiple'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "session_questions" ADD "kind" character varying(20) NOT NULL DEFAULT 'boolean'`,
    );
    await queryRunner.query(`ALTER TABLE "session_questions" ADD "options" jsonb`);
    await queryRunner.query(`ALTER TABLE "session_questions" ADD "correctIndex" smallint`);
    await queryRunner.query(
      `ALTER TABLE "session_questions" ADD CONSTRAINT "CHK_session_questions_kind" CHECK ("kind" IN ('boolean', 'multiple'))`,
    );

    await queryRunner.query(`ALTER TABLE "answers" ALTER COLUMN "choice" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "answers" ADD "choiceIndex" smallint`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "answers" SET "choice" = false WHERE "choice" IS NULL`);
    await queryRunner.query(`ALTER TABLE "answers" DROP COLUMN "choiceIndex"`);
    await queryRunner.query(`ALTER TABLE "answers" ALTER COLUMN "choice" SET NOT NULL`);

    await queryRunner.query(
      `ALTER TABLE "session_questions" DROP CONSTRAINT "CHK_session_questions_kind"`,
    );
    await queryRunner.query(`ALTER TABLE "session_questions" DROP COLUMN "correctIndex"`);
    await queryRunner.query(`ALTER TABLE "session_questions" DROP COLUMN "options"`);
    await queryRunner.query(`ALTER TABLE "session_questions" DROP COLUMN "kind"`);

    await queryRunner.query(`ALTER TABLE "questions" DROP CONSTRAINT "CHK_questions_kind"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "correctIndex"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "options"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "kind"`);
  }
}
