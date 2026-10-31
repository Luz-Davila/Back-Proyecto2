/** Do not automatically export raw URLs, auth headers or SQL statement text. */
export const TELEMETRY_PRIVACY = {
  '@opentelemetry/instrumentation-http': { enabled: false },
  '@opentelemetry/instrumentation-express': { enabled: false },
  '@opentelemetry/instrumentation-pg': { enabled: false },
  '@opentelemetry/instrumentation-fs': { enabled: false },
} as const;
