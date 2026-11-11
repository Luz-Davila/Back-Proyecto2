import {
  Controller,
  Get,
  HttpException,
  Module,
  Param,
  type INestApplication,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { gameMetrics } from '../../test/support/game-metric-reader';
import { HttpMetrics, HTTP_METRICS } from './http-metrics';
import { HttpMetricsMiddleware } from './http-metrics.middleware';

@Controller('quizzes')
class ProbeController {
  @Get()
  list() {
    return [];
  }

  @Get(':id')
  read(@Param('id') id: string) {
    return { id };
  }

  @Get(':id/teapot')
  teapot(): never {
    throw new HttpException('teapot', 418);
  }

  @Get(':id/error')
  error(): never {
    throw new HttpException('error', 500);
  }
}

@Controller('sessions')
class SessionsProbeController {
  @Get(':code/state')
  state(@Param('code') code: string) {
    return { code };
  }
}

@Controller('health')
class HealthProbeController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [
    ProbeController,
    SessionsProbeController,
    HealthProbeController,
  ],
  providers: [HttpMetrics, HttpMetricsMiddleware],
})
class ProbeModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}

describe('Métricas HTTP centralizadas', () => {
  let app: INestApplication;
  let metrics: ReturnType<typeof gameMetrics>;

  beforeEach(async () => {
    metrics = gameMetrics();
    const module = await Test.createTestingModule({
      imports: [ProbeModule],
    })
      .overrideProvider(HttpMetrics)
      .useValue(new HttpMetrics(metrics.provider.getMeter('http-test')))
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    metrics.telemetry.onModuleDestroy();
    await metrics.provider.shutdown();
  });

  const server = () => app.getHttpServer() as Server;

  async function points() {
    return metrics.reader.points();
  }

  it('registra método, ruta normalizada, estado y duración en segundos', async () => {
    await request(server())
      .get('/quizzes/12345?token=secret-value')
      .set('Authorization', 'Bearer should-not-be-exported')
      .set('Cookie', 'session=should-not-be-exported')
      .expect(200);

    const rows = await points();
    const requests = rows.filter(
      (point) => point.name === HTTP_METRICS.requests,
    );
    const durations = rows.filter(
      (point) => point.name === HTTP_METRICS.duration,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      unit: '{request}',
      attributes: {
        'http.request.method': 'GET',
        'http.route': '/quizzes/:id',
        'http.response.status_code': 200,
      },
      value: 1,
    });
    expect(
      Object.keys(requests[0].attributes as Record<string, unknown>).sort(),
    ).toEqual([
      'http.request.method',
      'http.response.status_code',
      'http.route',
    ]);
    expect(durations).toHaveLength(1);
    expect(durations[0]).toMatchObject({
      unit: 's',
      attributes: {
        'http.request.method': 'GET',
        'http.route': '/quizzes/:id',
        'http.response.status_code': 200,
      },
      value: { count: 1 },
    });
    expect(Number((durations[0].value as { sum: number }).sum)).toBeGreaterThan(
      0,
    );
    expect(
      (
        durations[0].value as {
          buckets: { boundaries: number[] };
        }
      ).buckets.boundaries,
    ).toEqual([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
    expect(JSON.stringify(rows)).not.toMatch(
      /12345|token|secret-value|should-not-be-exported|Cookie/,
    );
  });

  it('normaliza rutas sin parámetros como /quizzes y /health', async () => {
    await request(server()).get('/quizzes').expect(200);
    await request(server()).get('/health').expect(200);

    const routes = (await points())
      .filter((point) => point.name === HTTP_METRICS.requests)
      .map(
        (point) => (point.attributes as Record<string, unknown>)['http.route'],
      )
      .sort();
    expect(routes).toEqual(['/health', '/quizzes']);
  });

  it('normaliza el código de sala y no lo exporta', async () => {
    await request(server()).get('/sessions/ABC234/state').expect(200);

    const rows = await points();
    const requestRow = rows.find(
      (point) => point.name === HTTP_METRICS.requests,
    );
    expect(requestRow).toMatchObject({
      attributes: {
        'http.request.method': 'GET',
        'http.route': '/sessions/:code/state',
        'http.response.status_code': 200,
      },
      value: 1,
    });
    expect(JSON.stringify(rows)).not.toContain('ABC234');
  });

  it('registra códigos de error y no duplica una solicitud', async () => {
    await request(server()).get('/quizzes/12345/teapot').expect(418);

    const rows = await points();
    const requests = rows.filter(
      (point) => point.name === HTTP_METRICS.requests,
    );
    const durations = rows.filter(
      (point) => point.name === HTTP_METRICS.duration,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      attributes: {
        'http.route': '/quizzes/:id/teapot',
        'http.response.status_code': 418,
      },
      value: 1,
    });
    expect(durations[0].value).toMatchObject({ count: 1 });
  });

  it('registra también respuestas 5xx', async () => {
    await request(server()).get('/quizzes/12345/error').expect(500);

    const requestRow = (await points()).find(
      (point) => point.name === HTTP_METRICS.requests,
    );
    expect(requestRow).toMatchObject({
      attributes: {
        'http.route': '/quizzes/:id/error',
        'http.response.status_code': 500,
      },
      value: 1,
    });
  });

  it('usa unmatched para rutas desconocidas sin exportar la URL', async () => {
    await request(server())
      .get('/ruta-inexistente?email=persona@example.test')
      .expect(404);

    const rows = await points();
    const requestRow = rows.find(
      (point) => point.name === HTTP_METRICS.requests,
    );
    expect(requestRow).toMatchObject({
      attributes: {
        'http.request.method': 'GET',
        'http.route': 'unmatched',
        'http.response.status_code': 404,
      },
      value: 1,
    });
    expect(JSON.stringify(rows)).not.toMatch(
      /ruta-inexistente|persona@example\.test|email=/,
    );
  });

  it('se instancia mediante DI sin un proveedor de métricas global', async () => {
    const module = await Test.createTestingModule({
      providers: [HttpMetrics],
    }).compile();
    expect(module.get(HttpMetrics)).toBeInstanceOf(HttpMetrics);
    await module.close();
  });

  it('no requiere exportador ni red para registrar o descartar una muestra', () => {
    const http = new HttpMetrics();
    expect(() => http.record('GET', '/health', 200, 0.01)).not.toThrow();
    expect(() => http.record('GET', '/health', 999, Number.NaN)).not.toThrow();
  });

  it('cuenta una sola vez una conexión interrumpida antes de finish', () => {
    const record = jest.fn();
    const middleware = new HttpMetricsMiddleware({
      record,
    } as unknown as HttpMetrics);
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableFinished: false,
    });
    const request = {
      method: 'GET',
      path: '/slow',
      route: { path: '/slow' },
      baseUrl: '',
    };
    middleware.use(request as never, response as never, () => {});
    response.emit('close');
    response.emit('finish');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      'GET',
      '/slow',
      499,
      expect.any(Number),
    );
  });
});
