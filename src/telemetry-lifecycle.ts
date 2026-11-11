import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { shutdownTelemetry } from './telemetry-runtime';

/** Nest drains modules first. Exporter shutdown must never call process.exit. */
@Injectable()
export class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTelemetry();
  }
}
