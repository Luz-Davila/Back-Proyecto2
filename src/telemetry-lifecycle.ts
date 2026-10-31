import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

interface TelemetryRuntime {
  shutdown(): Promise<void>;
}
let runtime: TelemetryRuntime | undefined;
export function registerTelemetry(sdk: TelemetryRuntime): void {
  runtime = sdk;
}

/** Nest drains modules first. Exporter shutdown must never call process.exit. */
@Injectable()
export class TelemetryLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    const sdk = runtime;
    runtime = undefined;
    try {
      await sdk?.shutdown();
    } catch {
      /* Exporter availability is optional. */
    }
  }
}
