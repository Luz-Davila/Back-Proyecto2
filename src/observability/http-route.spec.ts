import {
  isSocketIoPath,
  normalizeHttpMethod,
  normalizeHttpRoute,
} from './http-route';

describe('Normalización segura de rutas HTTP', () => {
  it('combina el controlador con el patrón y nunca usa la URL concreta', () => {
    expect(
      normalizeHttpRoute({
        baseUrl: '/quizzes',
        route: { path: '/:id' },
      }),
    ).toBe('/quizzes/:id');
    expect(
      normalizeHttpRoute({
        baseUrl: '/sessions',
        route: { path: '/:code/state' },
      }),
    ).toBe('/sessions/:code/state');
    expect(
      normalizeHttpRoute({
        baseUrl: '',
        route: { path: '/health' },
      }),
    ).toBe('/health');
    expect(
      normalizeHttpRoute({
        baseUrl: '/quizzes',
        route: { path: '/' },
      }),
    ).toBe('/quizzes');
  });

  it('no duplica el prefijo y acepta routeOptions como respaldo', () => {
    expect(
      normalizeHttpRoute({
        baseUrl: '/quizzes',
        route: { path: '/quizzes/:id' },
      }),
    ).toBe('/quizzes/:id');
    expect(
      normalizeHttpRoute({
        baseUrl: '',
        routeOptions: { url: '/quizzes/:id' },
      }),
    ).toBe('/quizzes/:id');
  });

  it('usa unmatched si no hay patrón o si detecta un identificador real', () => {
    expect(normalizeHttpRoute({ baseUrl: '' })).toBe('unmatched');
    expect(
      normalizeHttpRoute({
        baseUrl: '/sessions',
        route: { path: '/ABC234/state' },
      }),
    ).toBe('unmatched');
    expect(
      normalizeHttpRoute({
        baseUrl: '/quizzes',
        route: { path: '/123e4567-e89b-12d3-a456-426614174000' },
      }),
    ).toBe('unmatched');
    expect(
      normalizeHttpRoute({
        baseUrl: '',
        route: { path: '/bad?token=abc' },
      }),
    ).toBe('unmatched');
  });

  it('normaliza métodos y excluye el handshake de Socket.IO', () => {
    expect(normalizeHttpMethod('get')).toBe('GET');
    expect(normalizeHttpMethod('PROPFIND')).toBe('OTHER');
    expect(normalizeHttpMethod(undefined)).toBe('OTHER');
    expect(isSocketIoPath('/socket.io/')).toBe(true);
    expect(isSocketIoPath('/socket.io')).toBe(true);
    expect(isSocketIoPath('/health')).toBe(false);
  });
});
