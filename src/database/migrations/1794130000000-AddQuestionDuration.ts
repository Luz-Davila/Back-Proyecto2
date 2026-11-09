import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionDuration1794130000000 implements MigrationInterface {
  name = 'AddQuestionDuration1794130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "questions" ADD "durationSeconds" integer`);
    await queryRunner.query(
      `ALTER TABLE "questions" ADD CONSTRAINT "CHK_questions_duration" CHECK ("durationSeconds" IS NULL OR ("durationSeconds" BETWEEN 5 AND 120))`,
    );
    await queryRunner.query(`ALTER TABLE "session_questions" ADD "durationSeconds" integer`);
    await queryRunner.query(
      `ALTER TABLE "session_questions" ADD CONSTRAINT "CHK_session_questions_duration" CHECK ("durationSeconds" IS NULL OR ("durationSeconds" BETWEEN 5 AND 120))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session_questions" DROP CONSTRAINT "CHK_session_questions_duration"`);
    await queryRunner.query(`ALTER TABLE "session_questions" DROP COLUMN "durationSeconds"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP CONSTRAINT "CHK_questions_duration"`);
    await queryRunner.query(`ALTER TABLE "questions" DROP COLUMN "durationSeconds"`);
  }
}
