import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionClock } from './session.clock';
import { SessionsRepository } from './sessions.repository';

@Injectable()
export class SessionDeadlinesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionDeadlinesService.name);
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly repository: SessionsRepository,
    private readonly lifecycle: SessionLifecycleService,
    private readonly clock: SessionClock,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.tick();
    if (!this.stopping)
      this.timer = setInterval(() => {
        void this.tick();
      }, 250);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }

  tick(): Promise<void> {
    if (this.active) return this.active;
    if (this.stopping) return Promise.resolve();
    this.active = this.drain()
      .catch(() => {
        this.logger.error(
          'No se pudieron procesar los plazos de sesiones; se reintentará',
        );
      })
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }

  private async drain(): Promise<void> {
    const deadlines = await this.repository.dueDeadlines(this.clock.now());
    for (const deadline of deadlines) {
      if (this.stopping) break;
      try {
        await this.lifecycle.processDeadline(deadline);
      } catch {
        this.logger.error(
          'Falló un plazo de sesión; el estado persistido permite reintentarlo',
        );
      }
    }
  }
}
