import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from '../../src/database/database.options';

function databaseTarget(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} debe ser una URL válida de PostgreSQL`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.pathname.length <= 1
  ) {
    throw new Error(`${name} debe indicar una base de datos PostgreSQL`);
  }
  // Cambiar credenciales, SSL o search_path no convierte la misma BD en otra.
  return `${parsed.hostname.toLowerCase()}:${parsed.port || '5432'}${decodeURIComponent(parsed.pathname)}`;
}

export function sessionTestDatabaseOptions(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const url = environment.TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'Falta TEST_DATABASE_URL: configura una BD exclusiva de pruebas; no se usará DATABASE_URL',
    );
  }
  const target = databaseTarget(url, 'TEST_DATABASE_URL');
  const developmentUrl = environment.DATABASE_URL?.trim();
  if (
    developmentUrl &&
    target === databaseTarget(developmentUrl, 'DATABASE_URL')
  ) {
    throw new Error(
      'TEST_DATABASE_URL debe apuntar a una BD distinta de DATABASE_URL',
    );
  }
  const ssl = environment.TEST_DATABASE_SSL?.trim() || 'false';
  if (!['true', 'false'].includes(ssl)) {
    throw new Error('TEST_DATABASE_SSL debe ser true o false');
  }

  return {
    ...buildDatabaseOptions(url, ssl === 'true'),
    extra: { max: 8, connectionTimeoutMillis: 5_000 },
  };
}

export function loadSessionTestEnvironment(): void {
  config({ quiet: true });
  sessionTestDatabaseOptions();
}

/** Cada QueryRunner conectado reserva una conexión propia para las carreras. */
export function createSessionTestDataSource(): DataSource {
  loadSessionTestEnvironment();
  return new DataSource(sessionTestDatabaseOptions());
}
