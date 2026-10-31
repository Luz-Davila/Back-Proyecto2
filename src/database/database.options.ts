import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

export function buildDatabaseOptions(
  url: string,
  ssl: boolean,
): Extract<DataSourceOptions, { type: 'postgres' }> {
  return {
    type: 'postgres',
    url,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
    synchronize: false,
    migrationsRun: false,
  };
}
