import { UnauthorizedException } from '@nestjs/common';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  JWTVerifyGetKey,
  KeyLike,
  SignJWT,
} from 'jose';
import { AuthService } from './auth.service';

const ISSUER = 'https://proyecto-prueba.supabase.co/auth/v1';
const USER_ID = '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f';

describe('AuthService', () => {
  let service: AuthService;
  let privateKey: KeyLike;
  let keys: JWTVerifyGetKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const jwk = await exportJWK(pair.publicKey);
    keys = createLocalJWKSet({
      keys: [{ ...jwk, kid: 'test-key', alg: 'ES256' }],
    });
  });

  beforeEach(() => {
    service = new AuthService(keys, ISSUER);
  });

  async function signToken(
    options: {
      subject?: string;
      audience?: string;
      issuer?: string;
      expiresAt?: number | string;
      key?: KeyLike | Uint8Array;
    } = {},
  ) {
    return new SignJWT({ email: 'prueba@correo.test', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(options.subject ?? USER_ID)
      .setIssuer(options.issuer ?? ISSUER)
      .setAudience(options.audience ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(options.expiresAt ?? '1h')
      .sign(options.key ?? privateKey);
  }

  it('acepta un token válido y devuelve el usuario', async () => {
    const token = await signToken();

    await expect(service.verifyAccessToken(token)).resolves.toEqual({
      id: USER_ID,
      email: 'prueba@correo.test',
      role: 'authenticated',
    });
  });

  it('devuelve expiración verificada para sockets sin cambiar el usuario REST', async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = await signToken({ expiresAt });
    const result = await service.verifySocketToken(token);
    expect(result.user.id).toBe(USER_ID);
    expect(result.expiresAt).toBe(expiresAt * 1000);
    expect(await service.verifyAccessToken(token)).not.toHaveProperty(
      'expiresAt',
    );
  });

  it('exige exp para sockets sin endurecer el contrato REST existente', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .sign(privateKey);
    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      id: USER_ID,
    });
    await expect(service.verifySocketToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it.each([
    { issuer: 'https://intruso.test' },
    { audience: 'anon' },
    { subject: 'no-uuid' },
    { expiresAt: 1 },
  ])('rechaza claims inválidos en tokens de socket: %j', async (options) => {
    await expect(
      service.verifySocketToken(await signToken(options)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un token vencido', async () => {
    const token = await signToken({
      expiresAt: Math.floor(Date.now() / 1000) - 60,
    });

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token con otro emisor', async () => {
    const token = await signToken({
      issuer: 'https://otro-proyecto.supabase.co/auth/v1',
    });

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token con otra audiencia', async () => {
    const token = await signToken({ audience: 'anon' });

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token firmado con otra clave', async () => {
    const intruder = await generateKeyPair('ES256');
    const token = await signToken({ key: intruder.privateKey });

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token firmado con HS256', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USER_ID)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(
        new TextEncoder().encode('secreto-de-prueba-con-longitud-suficiente'),
      );

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un token cuyo sujeto no es un identificador válido', async () => {
    const token = await signToken({ subject: 'no-es-un-uuid' });

    await expect(service.verifyAccessToken(token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza una cadena que no es un JWT', async () => {
    await expect(
      service.verifyAccessToken('esto-no-es-un-token'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
