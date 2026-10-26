import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import {
  SUPABASE_ALGORITHMS,
  SUPABASE_AUDIENCE,
  SUPABASE_ISSUER,
  SUPABASE_JWKS,
} from './auth.constants';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthService {
  constructor(
    @Inject(SUPABASE_JWKS) private readonly keys: JWTVerifyGetKey,
    @Inject(SUPABASE_ISSUER) private readonly issuer: string,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    let payload: Record<string, unknown>;

    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: SUPABASE_AUDIENCE,
        algorithms: SUPABASE_ALGORITHMS,
      }));
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
      throw new UnauthorizedException('Token sin usuario válido');
    }

    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      role: typeof payload.role === 'string' ? payload.role : undefined,
    };
  }
}
