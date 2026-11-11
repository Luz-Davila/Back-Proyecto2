interface TelemetryRuntime {
  shutdown(): Promise<void>;
}

let runtime: TelemetryRuntime | undefined;

/** Kept free of Nest imports so the SDK can start before Nest is loaded. */
export function registerTelemetry(sdk: TelemetryRuntime): void {
  runtime = sdk;
}

export async function shutdownTelemetry(): Promise<void> {
  const sdk = runtime;
  runtime = undefined;
  try {
    await sdk?.shutdown();
  } catch {
    /* Exporter availability is optional. */
  }
}
