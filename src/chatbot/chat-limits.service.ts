import { Injectable } from '@nestjs/common';
import { chatError } from './chat.errors';

@Injectable()
export class ChatLimitsService {
  private readonly users = new Map<
    string,
    { starts: number[]; active: boolean }
  >();

  acquire(userId: string): () => void {
    const cutoff = Date.now() - 60_000;
    for (const [id, entry] of this.users) {
      entry.starts = entry.starts.filter((time) => time > cutoff);
      if (!entry.active && !entry.starts.length) this.users.delete(id);
    }
    const entry = this.users.get(userId) ?? { starts: [], active: false };
    if (entry.active || entry.starts.length >= 5) {
      throw chatError(
        429,
        'CHAT_RATE_LIMITED',
        'Espera un momento antes de pedir otra respuesta (máximo cinco por minuto).',
      );
    }
    entry.starts.push(Date.now());
    entry.active = true;
    this.users.set(userId, entry);
    return () => {
      entry.active = false;
    };
  }
}
