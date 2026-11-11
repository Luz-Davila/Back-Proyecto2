import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import {
  createTelemetryConfig,
  parseOtlpHeaders,
  resolveOtlpProtocol,
} from './telemetry-config';
import { TELEMETRY_PRIVACY } from './telemetry-privacy';

describe('Configuración OTLP', () => {
  it('deriva métricas/trazas del endpoint base y usa http/protobuf por defecto', () => {
    expect(
      createTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway.example.test/otlp/',
        OTEL_SERVICE_NAME: 'profelink-api',
      }),
    ).toMatchObject({
      serviceName: 'profelink-api',
      metricsUrl: 'https://otlp-gateway.example.test/otlp/v1/metrics',
      tracesUrl: 'https://otlp-gateway.example.test/otlp/v1/traces',
      metricsProtocol: 'http/protobuf',
      tracesProtocol: 'http/protobuf',
    });
  });

  it('respeta endpoints, protocolos y headers por señal', () => {
    const config = createTelemetryConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://example.test/otlp',
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT:
        'https://metrics.example.test/v1/metrics',
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic abc==,X-Tenant=demo',
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: 'X-Signal=metrics',
    });
    expect(config).toMatchObject({
      metricsUrl: 'https://metrics.example.test/v1/metrics',
      tracesUrl: 'https://example.test/otlp/v1/traces',
      metricsProtocol: 'http/protobuf',
      tracesProtocol: 'http/json',
      metricsHeaders: { 'X-Signal': 'metrics' },
      tracesHeaders: { Authorization: 'Basic abc==', 'X-Tenant': 'demo' },
    });
  });

  it('no activa telemetría sin endpoint y normaliza protocolos desconocidos', () => {
    expect(createTelemetryConfig({})).toBeNull();
    expect(resolveOtlpProtocol(undefined)).toBe('http/protobuf');
    expect(resolveOtlpProtocol('http/json')).toBe('http/json');
    expect(resolveOtlpProtocol('grpc')).toBe('grpc');
    expect(resolveOtlpProtocol('tcp')).toBe('unsupported');
  });

  it('parsea headers sin perder credenciales con signos igual', () => {
    expect(parseOtlpHeaders('Authorization=Basic abc==, X-Env=prod')).toEqual({
      Authorization: 'Basic abc==',
      'X-Env': 'prod',
    });
    expect(parseOtlpHeaders('invalid,=empty,,X-A=1')).toEqual({ 'X-A': '1' });
    expect(parseOtlpHeaders('Authorization=Basic%20abc%3D%3D')).toEqual({
      Authorization: 'Basic abc==',
    });
    expect(parseOtlpHeaders('X-Bad=%E0%A4%A')).toEqual({ 'X-Bad': '%E0%A4%A' });
    expect(parseOtlpHeaders(undefined)).toBeUndefined();
  });

  it('mantiene deshabilitadas las instrumentaciones que exponen rutas o salas', () => {
    expect(TELEMETRY_PRIVACY['@opentelemetry/instrumentation-http']).toEqual({
      enabled: false,
    });
    expect(TELEMETRY_PRIVACY['@opentelemetry/instrumentation-express']).toEqual(
      { enabled: false },
    );
    expect(TELEMETRY_PRIVACY['@opentelemetry/instrumentation-pg']).toEqual({
      enabled: false,
    });
    expect(
      TELEMETRY_PRIVACY['@opentelemetry/instrumentation-nestjs-core'],
    ).toEqual({ enabled: false });
    expect(
      TELEMETRY_PRIVACY['@opentelemetry/instrumentation-socket.io'],
    ).toEqual({ enabled: false });

    const names = getNodeAutoInstrumentations(TELEMETRY_PRIVACY).map(
      (instrumentation) => instrumentation.instrumentationName,
    );
    expect(names).not.toContain('@opentelemetry/instrumentation-nestjs-core');
    expect(names).not.toContain('@opentelemetry/instrumentation-socket.io');
    expect(names).not.toContain('@opentelemetry/instrumentation-http');
  });
});
