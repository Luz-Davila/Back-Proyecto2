import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionBatchOperations1794096000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "question_batch_operations" (
      "userId" uuid NOT NULL, "quizId" uuid NOT NULL, "operationId" uuid NOT NULL,
      "payloadHash" varchar(64) NOT NULL, "receipt" jsonb NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_question_batch_operations" PRIMARY KEY ("userId", "quizId", "operationId"),
      CONSTRAINT "FK_question_batch_quiz" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(
      'ALTER TABLE "question_batch_operations" ENABLE ROW LEVEL SECURITY',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "question_batch_operations"');
  }
}
