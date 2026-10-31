import 'dotenv/config';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { registerTelemetry } from './telemetry-lifecycle';
import { TELEMETRY_PRIVACY } from './telemetry-privacy';

/**
 * Arranca OpenTelemetry antes de cargar la aplicación para que la
 * instrumentos usen el proveedor configurado. Se excluyen HTTP/PG automáticos
 * para no exportar URLs con códigos, cabeceras o sentencias SQL sin sanear.
 *
 * Si OTEL_EXPORTER_OTLP_ENDPOINT no está definido, la telemetría queda
 * desactivada y la API funciona igual.
 */
export function startTelemetry(): NodeSDK | null {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '');

  if (!endpoint) {
    return null;
  }

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'profelink-api',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 15_000,
      }),
    ],
    instrumentations: [getNodeAutoInstrumentations(TELEMETRY_PRIVACY)],
  });

  sdk.start();

  registerTelemetry(sdk);

  return sdk;
}

startTelemetry();
