/**
 * Automatic instrumentation is intentionally limited to avoid exporting raw
 * URLs, room codes, auth headers, SQL text, or socket room identifiers.
 * HTTP metrics are recorded by the project's own route-normalized middleware.
 */
export const TELEMETRY_PRIVACY = {
  '@opentelemetry/instrumentation-http': { enabled: false },
  '@opentelemetry/instrumentation-undici': { enabled: false },
  '@opentelemetry/instrumentation-express': { enabled: false },
  '@opentelemetry/instrumentation-pg': { enabled: false },
  '@opentelemetry/instrumentation-fs': { enabled: false },
  // Nest core spans include url.full, which can contain session codes.
  '@opentelemetry/instrumentation-nestjs-core': { enabled: false },
  // Socket.IO spans include rooms such as session:<sessionId>.
  '@opentelemetry/instrumentation-socket.io': { enabled: false },
} as const;
