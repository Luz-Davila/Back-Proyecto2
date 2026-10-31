import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createLocalJWKSet, type JSONWebKeySet } from 'jose';
import { AuthModule } from '../../src/auth/auth.module';
import { SUPABASE_ISSUER, SUPABASE_JWKS } from '../../src/auth/auth.constants';
import { SessionsModule } from '../../src/sessions/sessions.module';
import { GameTelemetry } from '../../src/sessions/game-telemetry';
import { StorageService } from '../../src/storage/storage.service';
import { localGameDatabase } from './local-game-database';
import { gameMetrics } from './game-metric-reader';

/** Isolated test entry point. Never imported by the production application. */
async function main(): Promise<void> {
  if (
    !process.send ||
    !process.env.LOCAL_GAME_JWKS ||
    !process.env.LOCAL_GAME_SCHEMA
  )
    throw new Error('Este proceso requiere el padre local');
  const ds = localGameDatabase(process.env.LOCAL_GAME_SCHEMA);
  const m = gameMetrics();
  await ds.initialize();
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      TypeOrmModule.forRoot(ds.options),
      AuthModule,
      SessionsModule,
    ],
  })
    .overrideProvider(DataSource)
    .useValue(ds)
    .overrideProvider(SUPABASE_ISSUER)
    .useValue('https://game.local.test/auth/v1')
    .overrideProvider(SUPABASE_JWKS)
    .useValue(
      createLocalJWKSet(
        JSON.parse(process.env.LOCAL_GAME_JWKS) as JSONWebKeySet,
      ),
    )
    .overrideProvider(StorageService)
    .useValue({ signedUrl: async () => 'https://storage.local.test/image.png' })
    .overrideProvider(GameTelemetry)
    .useValue(m.telemetry)
    .compile()
    .catch(async (error: unknown) => {
      try {
        if (ds.isInitialized) await ds.destroy();
      } finally {
        m.telemetry.onModuleDestroy();
        await m.provider.shutdown();
      }
      throw error;
    });
  const app = module.createNestApplication();
  app.useLogger(false);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await app.close();
      if (ds.isInitialized) await ds.destroy();
      await m.provider.shutdown();
      if (process.connected) process.disconnect();
    })());
  process.once('SIGTERM', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  process.once('SIGINT', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  process.once('disconnect', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  process.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object' || !('kind' in message)) return;
    if (message.kind === 'stop')
      void close().catch(() => {
        process.exitCode = 1;
      });
    if (message.kind === 'metrics' && 'id' in message) {
      const id = message.id;
      void m.reader
        .points()
        .then((points) =>
          process.send?.({
            kind: 'metrics',
            id,
            connections: m.telemetry.connectionCount(),
            points,
          }),
        )
        .catch(() => process.send?.({ kind: 'failure', id }));
    }
  });
  await app.listen(0, '127.0.0.1');
  process.send({ kind: 'ready', url: await app.getUrl(), pid: process.pid });
}
void main().catch(() => {
  process.send?.({ kind: 'failure' });
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
