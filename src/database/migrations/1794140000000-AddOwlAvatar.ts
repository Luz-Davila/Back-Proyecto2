import { MigrationInterface, QueryRunner } from 'typeorm';

const AVATARS = `'book', 'gamer', 'lab', 'detective', 'wizard', 'sport', 'explorer', 'sleepy', 'idea'`;

export class AddOwlAvatar1794140000000 implements MigrationInterface {
  name = 'AddOwlAvatar1794140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD "avatarId" character varying(20) NOT NULL DEFAULT 'book'`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "CHK_profiles_avatarId" CHECK ("avatarId" IN (${AVATARS}))`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" ADD "avatarId" character varying(20) NOT NULL DEFAULT 'book'`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" ADD CONSTRAINT "CHK_session_participants_avatarId" CHECK ("avatarId" IN (${AVATARS}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_participants" DROP CONSTRAINT "CHK_session_participants_avatarId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" DROP COLUMN "avatarId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" DROP CONSTRAINT "CHK_profiles_avatarId"`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN "avatarId"`);
  }
}
