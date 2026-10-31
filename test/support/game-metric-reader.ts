import { MeterProvider, MetricReader } from '@opentelemetry/sdk-metrics';
import { GameTelemetry } from '../../src/sessions/game-telemetry';

/** Pull-only local receiver: no global provider, exporter network or timer. */
export class GameMetricReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  async points() {
    const result = await this.collect();
    if (result.errors.length) throw new Error('Metric collection failed');
    return result.resourceMetrics.scopeMetrics.flatMap((scope) =>
      scope.metrics.flatMap((metric) =>
        metric.dataPoints.map((point) => ({
          name: metric.descriptor.name,
          unit: metric.descriptor.unit,
          attributes: point.attributes,
          value: point.value,
        })),
      ),
    );
  }
}
export function gameMetrics(extraReaders: MetricReader[] = []) {
  const reader = new GameMetricReader();
  const provider = new MeterProvider({ readers: [reader, ...extraReaders] });
  const telemetry = new GameTelemetry(provider.getMeter('profelink-game-test'));
  return { reader, provider, telemetry };
}
