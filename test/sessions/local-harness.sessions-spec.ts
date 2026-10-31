import { DataSource } from 'typeorm';
import { localGameDatabase } from '../support/local-game-database';
import { createLocalGameHarness } from '../support/local-game-harness';

describe('Limpieza de recursos propios del harness', () => {
  it('fallar migraciones limpia el esquema creado y libera conexiones', async () => {
    const admin = localGameDatabase();
    await admin.initialize();
    const schemas = () =>
      admin.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'game_local_%' ORDER BY schema_name`,
      );
    try {
      const before = await schemas();
      jest
        .spyOn(DataSource.prototype, 'runMigrations')
        .mockRejectedValueOnce(new Error('local migration failure'));
      await expect(createLocalGameHarness()).rejects.toThrow(
        'local migration failure',
      );
      expect(await schemas()).toEqual(before);
    } finally {
      jest.restoreAllMocks();
      await admin.destroy();
    }
  });

  it('cerrar dos veces sin hijo libera solo el esquema propio', async () => {
    const h = await createLocalGameHarness();
    const schema = h.schema;
    await h.close();
    await h.close();
    const admin = localGameDatabase();
    await admin.initialize();
    try {
      expect(
        await admin.query(
          'SELECT schema_name FROM information_schema.schemata WHERE schema_name=$1',
          [schema],
        ),
      ).toEqual([]);
    } finally {
      await admin.destroy();
    }
  });
});
