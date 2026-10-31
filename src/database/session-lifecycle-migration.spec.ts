import type { QueryRunner } from 'typeorm';
import { AddSessionLifecycle1793158800000 } from './migrations/1793158800000-AddSessionLifecycle';

describe('Preflight de la migración de sesiones (sin conexión)', () => {
  const migration = new AddSessionLifecycle1793158800000();
  const validPreflight = {
    hasInProgress: false,
    hasHostParticipant: false,
    hasMultipleActiveSessions: false,
  };

  function runner(preflight = validPreflight, isTransactionActive = true) {
    const query = jest.fn().mockResolvedValue([]);
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([preflight]);
    return { query, isTransactionActive };
  }

  it('exige transacción antes de consultar o cambiar datos', async () => {
    const fake = runner(validPreflight, false);
    await expect(migration.up(fake as unknown as QueryRunner)).rejects.toThrow(
      'transacción',
    );
    await expect(
      migration.down(fake as unknown as QueryRunner),
    ).rejects.toThrow('transacción');
    expect(fake.query).not.toHaveBeenCalled();
  });

  it.each([
    ['hasInProgress', 'partidas heredadas'],
    ['hasHostParticipant', 'host registrado'],
    ['hasMultipleActiveSessions', 'varias salas activas'],
  ] as const)(
    'aborta ante %s antes de ejecutar DDL o backfill',
    async (field, message) => {
      const fake = runner({ ...validPreflight, [field]: true });

      await expect(
        migration.up(fake as unknown as QueryRunner),
      ).rejects.toThrow(message);
      expect(fake.query).toHaveBeenCalledTimes(2);
      expect(fake.query.mock.calls[0][0]).toContain('LOCK TABLE');
      expect(fake.query.mock.calls[1][0]).toContain('SELECT');
    },
  );

  it('bloquea, comprueba y solo después crea la reserva con RLS y backfill', async () => {
    const fake = runner();
    await migration.up(fake as unknown as QueryRunner);
    const sql = fake.query.mock.calls
      .map(([statement]: [string]) => statement)
      .join('\n');

    expect(sql).toContain('PRIMARY KEY ("userId")');
    expect(sql).toContain(
      'REFERENCES "session_participants" ("sessionId", "userId") ON DELETE CASCADE',
    );
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("WHERE s.status = 'WAITING'");
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE/);
  });

  it('la reversión no elimina las tablas históricas existentes', async () => {
    const fake = runner();
    await migration.down(fake as unknown as QueryRunner);
    const sql = fake.query.mock.calls
      .map(([statement]: [string]) => statement)
      .join('\n');

    expect(sql).toContain('DROP TABLE "active_session_memberships"');
    expect(sql).not.toMatch(
      /DROP TABLE "(game_sessions|session_questions|session_participants|answers|game_results)"/,
    );
    expect(sql).not.toContain('DELETE FROM');
  });
});
