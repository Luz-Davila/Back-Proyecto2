import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileRole1793480000000 implements MigrationInterface {
  name = 'AddProfileRole1793480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD "role" character varying(20) NOT NULL DEFAULT 'student'`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "CHK_profiles_role" CHECK ("role" IN ('teacher', 'student'))`,
    );
    await queryRunner.query(
      `UPDATE "profiles" SET "role" = 'teacher'
       WHERE "userId" IN (SELECT DISTINCT "ownerId" FROM "quizzes")
          OR "userId" IN (SELECT DISTINCT "hostId" FROM "game_sessions")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" DROP CONSTRAINT "CHK_profiles_role"`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "role"`);
  }
}
