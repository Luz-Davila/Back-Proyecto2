import { MigrationInterface, QueryRunner } from 'typeorm';

const AVATARS = `'book', 'gamer', 'lab', 'detective', 'wizard', 'sport', 'explorer', 'sleepy', 'idea', 'scholar', 'astronaut', 'chef', 'artist', 'musician', 'hero', 'firefighter', 'pirate', 'angel', 'mechanic', 'king'`;
const LEGACY = `'book', 'gamer', 'lab', 'detective', 'wizard', 'sport', 'explorer', 'sleepy', 'idea'`;

export class ExpandOwlAvatars1794150000000 implements MigrationInterface {
  name = 'ExpandOwlAvatars1794150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP CONSTRAINT "CHK_profiles_avatarId"`);
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "CHK_profiles_avatarId" CHECK ("avatarId" IN (${AVATARS}))`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" DROP CONSTRAINT "CHK_session_participants_avatarId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" ADD CONSTRAINT "CHK_session_participants_avatarId" CHECK ("avatarId" IN (${AVATARS}))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "session_participants" SET "avatarId" = 'book' WHERE "avatarId" NOT IN (${LEGACY})`,
    );
    await queryRunner.query(
      `UPDATE "profiles" SET "avatarId" = 'book' WHERE "avatarId" NOT IN (${LEGACY})`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" DROP CONSTRAINT "CHK_session_participants_avatarId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_participants" ADD CONSTRAINT "CHK_session_participants_avatarId" CHECK ("avatarId" IN (${LEGACY}))`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" DROP CONSTRAINT "CHK_profiles_avatarId"`);
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "CHK_profiles_avatarId" CHECK ("avatarId" IN (${LEGACY}))`,
    );
  }
}
