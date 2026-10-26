import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import { AuthController } from './auth.controller';
import { SUPABASE_ISSUER, SUPABASE_JWKS } from './auth.constants';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: SUPABASE_ISSUER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        `${config.getOrThrow<string>('SUPABASE_URL').replace(/\/$/, '')}/auth/v1`,
    },
    {
      provide: SUPABASE_JWKS,
      inject: [SUPABASE_ISSUER],
      useFactory: (issuer: string) =>
        createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
    },
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
