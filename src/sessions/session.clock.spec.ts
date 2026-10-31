import {
  createSessionFixture,
  ManualSessionClock,
} from '../../test/support/session-fixtures';
import { SystemSessionClock } from './session.clock';
import { DEFAULT_REVIEW_DURATION_SECONDS } from './session.contracts';

describe('Reloj de sesiones', () => {
  it('el reloj del servidor usa la hora actual', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-28T13:00:00.000Z'));
    try {
      expect(new SystemSessionClock().now().toISOString()).toBe(
        '2026-10-28T13:00:00.000Z',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([5, 15, 30, 120])(
    'avanza %i segundos más cinco de revisión sin esperas',
    (seconds) => {
      const { clock, host, player, session, participant, questions } =
        createSessionFixture(seconds);
      const start = clock.now().getTime();

      clock.advance(seconds * 1_000);
      expect(clock.now().getTime()).toBe(start + seconds * 1_000);
      clock.advance(DEFAULT_REVIEW_DURATION_SECONDS * 1000);
      expect(clock.now().getTime()).toBe(start + seconds * 1_000 + 5_000);
      expect(session.hostId).toBe(host.id);
      expect(participant.userId).toBe(player.id);
      expect(participant.userId).not.toBe(host.id);
      expect(questions.map((question) => question.position)).toEqual([0, 1]);
      expect(
        questions.every((question) => question.sessionId === session.id),
      ).toBe(true);
    },
  );

  it('no comparte referencias Date mutables con el consumidor', () => {
    const clock = new ManualSessionClock();
    const before = clock.now().toISOString();
    clock.now().setUTCFullYear(2030);
    expect(clock.now().toISOString()).toBe(before);
  });

  it.each([-1, NaN, Infinity])('rechaza avance inválido %s', (milliseconds) => {
    expect(() => new ManualSessionClock().advance(milliseconds)).toThrow();
  });

  it('crea salas y jugadores independientes entre fixtures', () => {
    const first = createSessionFixture();
    const second = createSessionFixture();

    expect(first.session.id).not.toBe(second.session.id);
    expect(first.player.id).not.toBe(second.player.id);
    first.clock.advance(15_000);
    expect(first.clock.now().getTime() - second.clock.now().getTime()).toBe(
      15_000,
    );
  });
});
