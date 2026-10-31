import {
  Module,
  RequestMethod,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ProfilesModule } from '../profiles/profiles.module';
import { StorageModule } from '../storage/storage.module';
import { SessionCodeGenerator } from './session-code.generator';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionDeadlinesService } from './session-deadlines.service';
import { SessionExceptionFilter } from './session-exception.filter';
import { SessionRoomsService } from './session-rooms.service';
import { SessionStateProjector } from './session-state.projector';
import { SessionClock, SystemSessionClock } from './session.clock';
import { SessionsRepository } from './sessions.repository';
import { SessionsController } from './sessions.controller';
import { AuthModule } from '../auth/auth.module';
import { SessionCoordinator } from './session-coordinator';
import { SessionNotifications } from './session-notifications';
import { SessionSocketAuthService } from './realtime/session-socket-auth.service';
import { SessionRealtimeHub } from './realtime/session-realtime.hub';
import { SessionRealtimeService } from './realtime/session-realtime.service';
import { SessionsGateway } from './realtime/sessions.gateway';
import { SessionAnswersService } from './session-answers.service';
import { GameTelemetry } from './game-telemetry';
import { SessionRecoveryMiddleware } from './session-recovery.middleware';

@Module({
  imports: [ProfilesModule, StorageModule, AuthModule],
  controllers: [SessionsController],
  providers: [
    GameTelemetry,
    SessionsRepository,
    SessionCodeGenerator,
    SessionRoomsService,
    SessionLifecycleService,
    SessionStateProjector,
    SessionDeadlinesService,
    SessionCoordinator,
    SessionNotifications,
    SessionSocketAuthService,
    SessionRealtimeHub,
    SessionRealtimeService,
    SessionsGateway,
    SessionAnswersService,
    { provide: APP_FILTER, useClass: SessionExceptionFilter },
    { provide: SessionClock, useClass: SystemSessionClock },
  ],
  exports: [
    SessionsRepository,
    SessionClock,
    SessionRoomsService,
    SessionLifecycleService,
    SessionAnswersService,
  ],
})
export class SessionsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SessionRecoveryMiddleware)
      .forRoutes({ path: 'sessions/:code/state', method: RequestMethod.GET });
  }
}
