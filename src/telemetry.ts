import 'dotenv/config';
import { diag } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter as OtlpJsonMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPMetricExporter as OtlpProtoMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter as OtlpJsonTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OtlpProtoTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  createTelemetryConfig,
  type OtlpProtocol,
  type TelemetryConfig,
} from './telemetry-config';
import { TELEMETRY_PRIVACY } from './telemetry-privacy';
import { registerTelemetry } from './telemetry-runtime';

let running: NodeSDK | null | undefined;

function isHttp(protocol: OtlpProtocol): boolean {
  return protocol === 'http/protobuf' || protocol === 'http/json';
}

function metricExporter(config: TelemetryConfig, protocol: OtlpProtocol) {
  const options = {
    url: config.metricsUrl,
    headers: config.metricsHeaders,
  };
  return protocol === 'http/json'
    ? new OtlpJsonMetricExporter(options)
    : new OtlpProtoMetricExporter(options);
}

function traceExporter(config: TelemetryConfig, protocol: OtlpProtocol) {
  const options = {
    url: config.tracesUrl,
    headers: config.tracesHeaders,
  };
  return protocol === 'http/json'
    ? new OtlpJsonTraceExporter(options)
    : new OtlpProtoTraceExporter(options);
}

/**
 * Start OpenTelemetry before Nest is imported. The only automatic
 * instrumentations enabled are those that do not export URLs, headers, SQL or
 * room identifiers; HTTP metrics come from HttpMetricsMiddleware.
 *
 * A missing endpoint or an unsupported transport disables telemetry without
 * preventing the API from starting. Exporter failures are best effort.
 */
export function startTelemetry(): NodeSDK | null {
  if (running !== undefined) return running;

  const config = createTelemetryConfig();
  if (!config) {
    running = null;
    return null;
  }
  if (!isHttp(config.metricsProtocol)) {
    diag.warn(
      'OpenTelemetry disabled: only http/protobuf and http/json OTLP transports are supported.',
    );
    running = null;
    return null;
  }

  if (!isHttp(config.tracesProtocol))
    diag.warn(
      'OpenTelemetry traces disabled: only http/protobuf and http/json OTLP transports are supported.',
    );

  try {
    const sdk = new NodeSDK({
      serviceName: config.serviceName,
      ...(isHttp(config.tracesProtocol)
        ? { traceExporter: traceExporter(config, config.tracesProtocol) }
        : {}),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter(config, config.metricsProtocol),
          exportIntervalMillis: 15_000,
        }),
      ],
      instrumentations: [getNodeAutoInstrumentations(TELEMETRY_PRIVACY)],
    });
    sdk.start();
    registerTelemetry(sdk);
    running = sdk;
    return sdk;
  } catch {
    diag.warn(
      'OpenTelemetry disabled: the OTLP exporter configuration could not be initialized.',
    );
    running = null;
    return null;
  }
}

startTelemetry();
