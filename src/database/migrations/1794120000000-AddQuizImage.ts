import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuizImage1794120000000 implements MigrationInterface {
  name = 'AddQuizImage1794120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "quizzes" ADD "imageKey" character varying(255)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "quizzes" DROP COLUMN "imageKey"`);
  }
}
