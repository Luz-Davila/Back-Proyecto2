import { sessionTestDatabaseOptions } from '../../test/support/session-test-database';

describe('Seguridad de la BD de pruebas de sesiones', () => {
  it('no usa DATABASE_URL como alternativa', () => {
    expect(() =>
      sessionTestDatabaseOptions({
        DATABASE_URL: 'postgres://localhost/development',
      }),
    ).toThrow('Falta TEST_DATABASE_URL');
  });

  it('rechaza la misma BD incluso con otras credenciales, protocolo o parámetros', () => {
    expect(() =>
      sessionTestDatabaseOptions({
        DATABASE_URL: 'postgresql://owner:secret@localhost:5432/development',
        TEST_DATABASE_URL:
          'postgres://tester:other@localhost/development?sslmode=disable',
      }),
    ).toThrow('BD distinta');
  });

  it.each(['no-es-url', 'https://localhost/test', 'postgres://localhost/'])(
    'rechaza URL inválida sin revelar sus credenciales: %s',
    (url) => {
      expect(() =>
        sessionTestDatabaseOptions({ TEST_DATABASE_URL: url }),
      ).toThrow('PostgreSQL');
    },
  );

  it('acepta una BD separada sin sincronización ni migraciones automáticas', () => {
    const options = sessionTestDatabaseOptions({
      DATABASE_URL: 'postgres://localhost/development',
      TEST_DATABASE_URL: 'postgres://localhost/profelink_test',
    });

    expect(options).toMatchObject({
      type: 'postgres',
      url: 'postgres://localhost/profelink_test',
      ssl: false,
      synchronize: false,
      migrationsRun: false,
      extra: { max: 8 },
    });
  });

  it('usa únicamente TEST_DATABASE_SSL para configurar SSL', () => {
    expect(
      sessionTestDatabaseOptions({
        TEST_DATABASE_URL: 'postgres://localhost/test',
        DATABASE_SSL: 'true',
      }).ssl,
    ).toBe(false);
    expect(
      sessionTestDatabaseOptions({
        TEST_DATABASE_URL: 'postgres://localhost/test',
        TEST_DATABASE_SSL: 'true',
      }).ssl,
    ).toEqual({ rejectUnauthorized: false });
  });

  it('rechaza una configuración SSL ambigua', () => {
    expect(() =>
      sessionTestDatabaseOptions({
        TEST_DATABASE_URL: 'postgres://localhost/test',
        TEST_DATABASE_SSL: 'yes',
      }),
    ).toThrow('TEST_DATABASE_SSL');
  });
});
