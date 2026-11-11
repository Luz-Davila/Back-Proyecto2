import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { HttpMetrics } from './http-metrics';
import {
  isSocketIoPath,
  normalizeHttpMethod,
  normalizeHttpRoute,
} from './http-route';

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: HttpMetrics) {}

  use(request: Request, response: Response, next: NextFunction): void {
    // Socket.IO's handshake is transport, not a REST endpoint. Its own
    // automatic instrumentation is disabled, so do not report it as unmatched.
    if (isSocketIoPath(request.path)) {
      next();
      return;
    }

    const started = performance.now();
    let recorded = false;

    const record = (interrupted: boolean) => {
      if (recorded) return;
      recorded = true;
      response.off('finish', onFinish);
      response.off('close', onClose);
      const status =
        interrupted && !response.writableFinished && response.statusCode < 400
          ? 499
          : response.statusCode;
      this.metrics.record(
        normalizeHttpMethod(request.method),
        normalizeHttpRoute(request),
        status,
        (performance.now() - started) / 1000,
      );
    };
    const onFinish = () => record(false);
    const onClose = () => record(true);

    response.once('finish', onFinish);
    response.once('close', onClose);
    next();
  }
}
