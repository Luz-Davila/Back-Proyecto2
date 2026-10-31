import { createSessionTestDataSource } from '../support/session-test-database';

describe('PostgreSQL exclusivo de pruebas de sesiones', () => {
  const dataSource = createSessionTestDataSource();

  beforeAll(async () => {
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });

  it('reserva conexiones independientes para operaciones concurrentes', async () => {
    const first = dataSource.createQueryRunner();
    const second = dataSource.createQueryRunner();
    try {
      await Promise.all([first.connect(), second.connect()]);
      const [a, b] = (await Promise.all([
        first.query('SELECT pg_backend_pid() AS pid'),
        second.query('SELECT pg_backend_pid() AS pid'),
      ])) as [Array<{ pid: number }>, Array<{ pid: number }>];

      expect(a[0].pid).not.toBe(b[0].pid);
    } finally {
      await Promise.all([first.release(), second.release()]);
    }
  });
});
