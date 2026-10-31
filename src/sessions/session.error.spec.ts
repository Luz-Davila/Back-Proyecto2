import { SESSION_ERRORS, SessionError } from './session.error';

describe('Errores de sesiones', () => {
  it.each(Object.keys(SESSION_ERRORS) as Array<keyof typeof SESSION_ERRORS>)(
    'define un mensaje y estado estable para %s',
    (code) => {
      const error = new SessionError(code);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SessionError');
      expect(error.code).toBe(code);
      expect(error.message).toBe(SESSION_ERRORS[code].message);
      expect(SESSION_ERRORS[code].statusCode).toBeGreaterThanOrEqual(400);
      expect(SESSION_ERRORS[code].statusCode).toBeLessThan(600);
    },
  );
});
