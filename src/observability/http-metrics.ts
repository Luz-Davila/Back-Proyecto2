import { Injectable, Optional } from '@nestjs/common';
import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
} from '@opentelemetry/api';

export const HTTP_METRICS = {
  requests: 'profelink.http.server.requests',
  duration: 'profelink.http.server.request.duration',
} as const;

const DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

function validStatus(status: number): number {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : 500;
}

function validDuration(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

@Injectable()
export class HttpMetrics {
  private readonly requests: Counter;
  private readonly duration: Histogram;

  constructor(@Optional() meter?: Meter) {
    const current = meter ?? metrics.getMeter('profelink-http');
    this.requests = current.createCounter(HTTP_METRICS.requests, {
      unit: '{request}',
      description: 'Completed or interrupted ProfeLink HTTP requests',
    });
    this.duration = current.createHistogram(HTTP_METRICS.duration, {
      unit: 's',
      description: 'Profelink HTTP request duration in seconds',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    });
  }

  /** Attributes are bounded to method, normalized route and numeric status. */
  record(method: string, route: string, status: number, seconds: number): void {
    const attributes = {
      'http.request.method': method,
      'http.route': route,
      'http.response.status_code': validStatus(status),
    };
    try {
      this.requests.add(1, attributes);
      this.duration.record(validDuration(seconds), attributes);
    } catch {
      /* Telemetry must never change the HTTP response. */
    }
  }
}
