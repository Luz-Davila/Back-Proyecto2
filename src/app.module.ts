import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { ProfilesModule } from './profiles/profiles.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { SessionsModule } from './sessions/sessions.module';
import { TelemetryLifecycle } from './telemetry-lifecycle';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      validate: validateEnv,
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    ProfilesModule,
    QuizzesModule,
    SessionsModule,
  ],
  controllers: [AppController],
  providers: [AppService, TelemetryLifecycle],
})
export class AppModule {}
