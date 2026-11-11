export type OtlpProtocol =
  'http/protobuf' | 'http/json' | 'grpc' | 'unsupported';

export interface TelemetryConfig {
  serviceName: string;
  metricsUrl: string;
  tracesUrl: string;
  metricsProtocol: OtlpProtocol;
  tracesProtocol: OtlpProtocol;
  metricsHeaders?: Record<string, string>;
  tracesHeaders?: Record<string, string>;
}

function endpoint(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || undefined;
}

function signalEndpoint(
  base: string,
  specific: string | undefined,
  path: string,
): string {
  return endpoint(specific) ?? `${base}${path}`;
}

/** OpenTelemetry's default is http/protobuf; be explicit for the installed SDK. */
export function resolveOtlpProtocol(value: string | undefined): OtlpProtocol {
  const protocol = value?.trim().toLowerCase();
  if (!protocol || protocol === 'http/protobuf') return 'http/protobuf';
  if (protocol === 'http/json') return 'http/json';
  if (protocol === 'grpc') return 'grpc';
  return 'unsupported';
}

/**
 * OTLP_HEADERS uses `key=value,key2=value2`. The value is kept verbatim so
 * Basic credentials containing `=` are not truncated. Never log this object.
 */
export function parseOtlpHeaders(
  value: string | undefined,
): Record<string, string> | undefined {
  if (!value?.trim()) return undefined;
  const headers: Record<string, string> = {};
  for (const item of value.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const raw = item.slice(separator + 1).trim();
    let headerValue = raw;
    try {
      headerValue = decodeURIComponent(raw);
    } catch {
      /* Keep malformed percent escapes verbatim. */
    }
    if (key && headerValue) headers[key] = headerValue;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/**
 * Resolve endpoints and per-signal overrides without reading secrets from code.
 * A base endpoint is required, matching the existing deployment contract.
 */
export function createTelemetryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TelemetryConfig | null {
  const base = endpoint(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (!base) return null;

  const commonHeaders = parseOtlpHeaders(
    environment.OTEL_EXPORTER_OTLP_HEADERS,
  );
  const metricsProtocol = resolveOtlpProtocol(
    environment.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL ??
      environment.OTEL_EXPORTER_OTLP_PROTOCOL,
  );
  const tracesProtocol = resolveOtlpProtocol(
    environment.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ??
      environment.OTEL_EXPORTER_OTLP_PROTOCOL,
  );

  return {
    serviceName: environment.OTEL_SERVICE_NAME?.trim() || 'profelink-api',
    metricsUrl: signalEndpoint(
      base,
      environment.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
      '/v1/metrics',
    ),
    tracesUrl: signalEndpoint(
      base,
      environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      '/v1/traces',
    ),
    metricsProtocol,
    tracesProtocol,
    metricsHeaders:
      parseOtlpHeaders(environment.OTEL_EXPORTER_OTLP_METRICS_HEADERS) ??
      commonHeaders,
    tracesHeaders:
      parseOtlpHeaders(environment.OTEL_EXPORTER_OTLP_TRACES_HEADERS) ??
      commonHeaders,
  };
}
