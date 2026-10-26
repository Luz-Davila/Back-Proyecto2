import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

class PublicController {
  @Public()
  open() {
    return 'abierto';
  }

  closed() {
    return 'cerrado';
  }
}

function createContext(
  handler: (...args: unknown[]) => unknown,
  request: { headers: Record<string, string | undefined>; user?: unknown },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => PublicController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let verifyAccessToken: jest.Mock;
  let guard: AuthGuard;

  beforeEach(() => {
    verifyAccessToken = jest.fn();
    guard = new AuthGuard(new Reflector(), { verifyAccessToken } as unknown as AuthService);
  });

  it('permite el acceso a rutas públicas sin token', async () => {
    const context = createContext(PublicController.prototype.open, { headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rechaza una ruta protegida sin encabezado Authorization', async () => {
    const context = createContext(PublicController.prototype.closed, { headers: {} });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rechaza un encabezado que no usa el esquema Bearer', async () => {
    const context = createContext(PublicController.prototype.closed, {
      headers: { authorization: 'Basic abc123' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('adjunta el usuario verificado a la petición', async () => {
    const user = { id: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f', email: 'prueba@correo.test' };
    verifyAccessToken.mockResolvedValue(user);
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: 'Bearer token-de-prueba' },
    };

    await expect(
      guard.canActivate(createContext(PublicController.prototype.closed, request)),
    ).resolves.toBe(true);

    expect(verifyAccessToken).toHaveBeenCalledWith('token-de-prueba');
    expect(request.user).toEqual(user);
  });

  it('propaga el rechazo cuando el token no es válido', async () => {
    verifyAccessToken.mockRejectedValue(new UnauthorizedException('Token inválido o expirado'));
    const request = { headers: { authorization: 'Bearer token-malo' }, user: undefined };

    await expect(
      guard.canActivate(createContext(PublicController.prototype.closed, request)),
    ).rejects.toThrow(UnauthorizedException);
    expect(request.user).toBeUndefined();
  });
});
