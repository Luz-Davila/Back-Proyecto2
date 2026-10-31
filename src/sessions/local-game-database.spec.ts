import { localGameDatabaseOptions } from '../../test/support/local-game-database';
const url = 'postgresql://test:local@127.0.0.1:15433/exclusive';
describe('Seguridad del harness local antes de abrir conexiones', () => {
  it('acepta exclusivamente la BD de pruebas de loopback', () => {
    expect(localGameDatabaseOptions({ TEST_DATABASE_URL: url }).type).toBe(
      'postgres',
    );
  });
  it('no hace fallback a desarrollo', () => {
    expect(() => localGameDatabaseOptions({ DATABASE_URL: url })).toThrow(
      'TEST_DATABASE_URL',
    );
  });
  it('rechaza servidores remotos', () => {
    expect(() =>
      localGameDatabaseOptions({
        TEST_DATABASE_URL: url.replace('127.0.0.1', 'remote.example.test'),
      }),
    ).toThrow('loopback');
  });
  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'no permite alias de desarrollo %s',
    (host) => {
      expect(() =>
        localGameDatabaseOptions({
          TEST_DATABASE_URL: url,
          DATABASE_URL: url.replace('127.0.0.1', host),
        }),
      ).toThrow();
    },
  );
});
