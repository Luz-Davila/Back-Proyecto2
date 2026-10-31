import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { GameTelemetry } from './game-telemetry';

@Injectable()
export class SessionRecoveryMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: GameTelemetry) {}
  use(_request: Request, response: Response, next: NextFunction): void {
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      response.off('finish', record);
      response.off('close', record);
      this.telemetry.httpRecovery(
        response.statusCode,
        response.writableFinished,
      );
    };
    response.once('finish', record);
    response.once('close', record);
    next();
  }
}
