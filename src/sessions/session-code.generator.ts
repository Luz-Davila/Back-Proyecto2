import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

export const SESSION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SESSION_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const SESSION_CODE_ATTEMPTS = 10;

@Injectable()
export class SessionCodeGenerator {
  generate(): string {
    return Array.from(
      { length: 6 },
      () => SESSION_CODE_ALPHABET[randomInt(SESSION_CODE_ALPHABET.length)],
    ).join('');
  }
}

export function isUniqueConstraintError(
  error: unknown,
  constraint: string,
): boolean {
  if (!error || typeof error !== 'object' || !('driverError' in error))
    return false;
  const driver = error.driverError;
  return Boolean(
    driver &&
    typeof driver === 'object' &&
    'code' in driver &&
    driver.code === '23505' &&
    'constraint' in driver &&
    driver.constraint === constraint,
  );
}
