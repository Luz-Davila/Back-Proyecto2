import { randomUUID } from 'crypto';
import type { Server } from 'http';
import { ConfigModule } from '@nestjs/config';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthModule } from '../../src/auth/auth.module';
import { AuthService } from '../../src/auth/auth.service';
import type { AuthenticatedUser } from '../../src/auth/auth.service';
import { Profile } from '../../src/profiles/profile.entity';
import { Quiz } from '../../src/quizzes/quiz.entity';
import { Question } from '../../src/quizzes/question.entity';
import { SessionCodeGenerator } from '../../src/sessions/session-code.generator';
import { SessionDeadlinesService } from '../../src/sessions/session-deadlines.service';
import { SessionLifecycleService } from '../../src/sessions/session-lifecycle.service';
import { SessionAnswersService } from '../../src/sessions/session-answers.service';
import { GameTelemetry } from '../../src/sessions/game-telemetry';
import { SessionRoomsService } from '../../src/sessions/session-rooms.service';
import { SessionClock } from '../../src/sessions/session.clock';
import { SessionsModule } from '../../src/sessions/sessions.module';
import { SessionsRepository } from '../../src/sessions/sessions.repository';
import { StorageService } from '../../src/storage/storage.service';
import { ManualSessionClock } from './session-fixtures';
import {
  createSessionTestDataSource,
  sessionTestDatabaseOptions,
} from './session-test-database';

export async function createSessionTestContext(
  configuration: { auth?: AuthService; telemetry?: GameTelemetry } = {},
) {
  const admin = createSessionTestDataSource();
  await admin.initialize();
  const schema = `session_suite_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const options = sessionTestDatabaseOptions();
  const dataSource = new DataSource({
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema},public` },
  });
  const clock = new ManualSessionClock();
  const tokens = new Map<string, AuthenticatedUser>();
  const storage = {
    signedUrl: jest.fn(async () => 'https://storage.test/signed/image.png'),
  };
  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        TypeOrmModule.forRoot(options),
        AuthModule,
        SessionsModule,
      ],
    })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(SessionClock)
      .useValue(clock)
      .overrideProvider(GameTelemetry)
      .useValue(configuration.telemetry ?? new GameTelemetry())
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider(SessionDeadlinesService)
      .useValue({})
      .overrideProvider(AuthService)
      .useValue(
        configuration.auth ?? {
          verifyAccessToken: async (token: string) => {
            const user = tokens.get(token);
            if (!user) throw new UnauthorizedException();
            return user;
          },
        },
      )
      .compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    await app.init();
    const repository = app.get(SessionsRepository);
    const lifecycle = app.get(SessionLifecycleService);
    const rooms = app.get(SessionRoomsService);
    return {
      app,
      telemetry: app.get(GameTelemetry),
      dataSource,
      schema,
      clock,
      repository,
      lifecycle,
      answers: app.get(SessionAnswersService),
      rooms,
      storage,
      codes: app.get(SessionCodeGenerator),
      deadlines: new SessionDeadlinesService(repository, lifecycle, clock),
      user(): AuthenticatedUser {
        return { id: randomUUID(), displayName: 'Jugador de prueba' };
      },
      token(user: AuthenticatedUser): string {
        const token = randomUUID();
        tokens.set(token, user);
        return `Bearer ${token}`;
      },
      async seedQuiz(
        count = 2,
        owner: AuthenticatedUser = { id: randomUUID(), displayName: 'Host' },
      ) {
        await dataSource
          .getRepository(Profile)
          .save({ userId: owner.id, displayName: owner.displayName ?? 'Host' });
        const quiz = await dataSource
          .getRepository(Quiz)
          .save({ ownerId: owner.id, title: 'Cuestionario de prueba' });
        for (let position = 0; position < count; position++)
          await dataSource.getRepository(Question).save({
            quizId: quiz.id,
            statement: `Pregunta ${position}`,
            correctBoolean: position % 2 === 0,
            position,
          });
        return { owner, quiz };
      },
      async reset() {
        await dataSource.query(
          `TRUNCATE "${schema}".game_sessions, "${schema}".quizzes, "${schema}".profiles CASCADE`,
        );
        jest.restoreAllMocks();
      },
      async close() {
        await app.close();
        if (dataSource.isInitialized) await dataSource.destroy();
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.destroy();
      },
    };
  } catch (error) {
    if (dataSource.isInitialized) await dataSource.destroy();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.destroy();
    throw error;
  }
}

export type SessionTestContext = Awaited<
  ReturnType<typeof createSessionTestContext>
>;
