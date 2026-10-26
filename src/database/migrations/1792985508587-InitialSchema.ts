import { MigrationInterface, QueryRunner } from "typeorm";

// RLS activado sin políticas: Supabase expone el esquema public por su API.
// La API del juego accede con su propia conexión y valida permisos en NestJS.
const TABLES = [
    'profiles',
    'quizzes',
    'questions',
    'game_sessions',
    'session_questions',
    'session_participants',
    'game_results',
    'answers',
];

export class InitialSchema1792985508587 implements MigrationInterface {
    name = 'InitialSchema1792985508587'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "profiles" ("userId" uuid NOT NULL, "displayName" character varying(40) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_315ecd98bd1a42dcf2ec4e2e985" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE TABLE "quizzes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ownerId" uuid NOT NULL, "title" character varying(120) NOT NULL, "description" character varying(500), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b24f0f7662cf6b3a0e7dba0a1b4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4c665974bc1953517a4be879f7" ON "quizzes" ("ownerId") `);
        await queryRunner.query(`CREATE TABLE "questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "quizId" uuid NOT NULL, "statement" character varying(500) NOT NULL, "correctBoolean" boolean NOT NULL, "imageKey" character varying(255), "position" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_3e3e8cb5007e5d4401a07dfbd2b" UNIQUE ("quizId", "position"), CONSTRAINT "PK_08a6d4b0f49ff300bf3a0ca60ac" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "game_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(8) NOT NULL, "quizId" uuid, "hostId" uuid NOT NULL, "quizTitle" character varying(120) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'WAITING', "currentIndex" integer NOT NULL DEFAULT '-1', "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_f858da003eb0a766a3262d66c2" CHECK ("status" IN ('WAITING', 'IN_PROGRESS', 'FINISHED')), CONSTRAINT "PK_e25fa82d55744e55000c3288fdc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_977fe726299fc1600fed5bf9e3" ON "game_sessions" ("code") `);
        await queryRunner.query(`CREATE INDEX "IDX_f7b8d7d208b44a3c0c1bc91783" ON "game_sessions" ("hostId") `);
        await queryRunner.query(`CREATE TABLE "session_questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "originalQuestionId" uuid, "position" integer NOT NULL, "statement" character varying(500) NOT NULL, "correctBoolean" boolean NOT NULL, "imageKey" character varying(255), "status" character varying(20) NOT NULL DEFAULT 'PENDING', "openedAt" TIMESTAMP WITH TIME ZONE, "closesAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_f2310853d2d54821623dfe95bf8" UNIQUE ("sessionId", "position"), CONSTRAINT "CHK_3e7730e3a9c464e0da318fc512" CHECK ("status" IN ('PENDING', 'OPEN', 'CLOSED')), CONSTRAINT "PK_620bcd90fbd1cecc42ec217ac75" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "session_participants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "userId" uuid NOT NULL, "displayName" character varying(40) NOT NULL, "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_ac3fe05fedd83b14e7d7f7a0577" UNIQUE ("sessionId", "userId"), CONSTRAINT "PK_f186de01f7f809e45eaa9bd5b84" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f7e8440a17fb44d7ce9db398f8" ON "session_participants" ("userId") `);
        await queryRunner.query(`CREATE TABLE "game_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "participantId" uuid NOT NULL, "totalScore" integer NOT NULL, "rank" integer NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_b9231f3ddf6238d651fd47c59e6" UNIQUE ("sessionId", "participantId"), CONSTRAINT "PK_d45049161e874555e7cfe325afe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "answers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionQuestionId" uuid NOT NULL, "participantId" uuid NOT NULL, "choice" boolean NOT NULL, "answeredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "score" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_75600bfabe6672de6fec13b44fe" UNIQUE ("sessionQuestionId", "participantId"), CONSTRAINT "PK_9c32cec6c71e06da0254f2226c6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "quizzes" ADD CONSTRAINT "FK_4c665974bc1953517a4be879f74" FOREIGN KEY ("ownerId") REFERENCES "profiles"("userId") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "questions" ADD CONSTRAINT "FK_35d54f06d12ea78d4842aed6b6d" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_72ee19d61e5ecf4a656678c64c1" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_sessions" ADD CONSTRAINT "FK_f7b8d7d208b44a3c0c1bc917835" FOREIGN KEY ("hostId") REFERENCES "profiles"("userId") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_questions" ADD CONSTRAINT "FK_8e0db7473d7a4e28d9aa5f2902d" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_questions" ADD CONSTRAINT "FK_c7392d963ffa2622ff25b16774f" FOREIGN KEY ("originalQuestionId") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_participants" ADD CONSTRAINT "FK_405fbf7474a2df8d2131619ad1d" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "session_participants" ADD CONSTRAINT "FK_f7e8440a17fb44d7ce9db398f85" FOREIGN KEY ("userId") REFERENCES "profiles"("userId") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_results" ADD CONSTRAINT "FK_711e922855ab9f853caa9e69fdb" FOREIGN KEY ("sessionId") REFERENCES "game_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "game_results" ADD CONSTRAINT "FK_b18a45a6d1f35518cdb93554a5a" FOREIGN KEY ("participantId") REFERENCES "session_participants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "answers" ADD CONSTRAINT "FK_98a13a5fa98262f1420d89ef687" FOREIGN KEY ("sessionQuestionId") REFERENCES "session_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "answers" ADD CONSTRAINT "FK_9c0272d4fa59f297f4370f63ab5" FOREIGN KEY ("participantId") REFERENCES "session_participants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        for (const table of TABLES) {
            await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of TABLES) {
            await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
        }

        await queryRunner.query(`ALTER TABLE "answers" DROP CONSTRAINT "FK_9c0272d4fa59f297f4370f63ab5"`);
        await queryRunner.query(`ALTER TABLE "answers" DROP CONSTRAINT "FK_98a13a5fa98262f1420d89ef687"`);
        await queryRunner.query(`ALTER TABLE "game_results" DROP CONSTRAINT "FK_b18a45a6d1f35518cdb93554a5a"`);
        await queryRunner.query(`ALTER TABLE "game_results" DROP CONSTRAINT "FK_711e922855ab9f853caa9e69fdb"`);
        await queryRunner.query(`ALTER TABLE "session_participants" DROP CONSTRAINT "FK_f7e8440a17fb44d7ce9db398f85"`);
        await queryRunner.query(`ALTER TABLE "session_participants" DROP CONSTRAINT "FK_405fbf7474a2df8d2131619ad1d"`);
        await queryRunner.query(`ALTER TABLE "session_questions" DROP CONSTRAINT "FK_c7392d963ffa2622ff25b16774f"`);
        await queryRunner.query(`ALTER TABLE "session_questions" DROP CONSTRAINT "FK_8e0db7473d7a4e28d9aa5f2902d"`);
        await queryRunner.query(`ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_f7b8d7d208b44a3c0c1bc917835"`);
        await queryRunner.query(`ALTER TABLE "game_sessions" DROP CONSTRAINT "FK_72ee19d61e5ecf4a656678c64c1"`);
        await queryRunner.query(`ALTER TABLE "questions" DROP CONSTRAINT "FK_35d54f06d12ea78d4842aed6b6d"`);
        await queryRunner.query(`ALTER TABLE "quizzes" DROP CONSTRAINT "FK_4c665974bc1953517a4be879f74"`);
        await queryRunner.query(`DROP TABLE "answers"`);
        await queryRunner.query(`DROP TABLE "game_results"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f7e8440a17fb44d7ce9db398f8"`);
        await queryRunner.query(`DROP TABLE "session_participants"`);
        await queryRunner.query(`DROP TABLE "session_questions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f7b8d7d208b44a3c0c1bc91783"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_977fe726299fc1600fed5bf9e3"`);
        await queryRunner.query(`DROP TABLE "game_sessions"`);
        await queryRunner.query(`DROP TABLE "questions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4c665974bc1953517a4be879f7"`);
        await queryRunner.query(`DROP TABLE "quizzes"`);
        await queryRunner.query(`DROP TABLE "profiles"`);
    }

}
