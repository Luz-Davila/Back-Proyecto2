import { DataSource } from 'typeorm';
import {
  loadSessionTestEnvironment,
  sessionTestDatabaseOptions,
} from './session-test-database';

export function localGameDatabaseOptions(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const options = sessionTestDatabaseOptions(environment);
  const url = new URL(environment.TEST_DATABASE_URL!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('El harness solo acepta TEST_DATABASE_URL de loopback');
  if (environment.DATABASE_URL) {
    const development = new URL(environment.DATABASE_URL);
    if (
      ['127.0.0.1', 'localhost', '[::1]'].includes(development.hostname) &&
      (development.port || '5432') === (url.port || '5432') &&
      decodeURIComponent(development.pathname) ===
        decodeURIComponent(url.pathname)
    ) {
      throw new Error('El harness no acepta alias loopback de DATABASE_URL');
    }
  }
  return options;
}

export function localGameDatabase(schema?: string): DataSource {
  loadSessionTestEnvironment();
  if (schema && !/^game_local_[a-f0-9]{32}$/.test(schema))
    throw new Error('Esquema local inválido');
  const options = localGameDatabaseOptions();
  return new DataSource({
    ...options,
    ...(schema
      ? {
          schema,
          extra: {
            ...options.extra,
            options: `-c search_path=${schema},public`,
          },
        }
      : {}),
  });
}
