import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDatabaseOptions } from './database.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildDatabaseOptions(
          config.getOrThrow<string>('DATABASE_URL'),
          config.get<string>('DATABASE_SSL') === 'true',
        ),
    }),
  ],
})
export class DatabaseModule {}
