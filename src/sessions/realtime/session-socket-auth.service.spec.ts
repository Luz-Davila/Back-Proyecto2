import { UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';
import type { AuthService } from '../../auth/auth.service';
import { SessionSocketAuthService } from './session-socket-auth.service';

describe('Autenticación y renovación de sockets', () => {
  let service: SessionSocketAuthService;
  let socket: Socket;
  let disconnect: jest.Mock;
  const user = { id: 'same-account' };
  const verify = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
    verify.mockReset().mockImplementation((token: string) =>
      Promise.resolve({
        user: token === 'other' ? { id: 'other' } : user,
        expiresAt: token === 'new' ? 120_000 : 110_000,
      }),
    );
    service = new SessionSocketAuthService({
      verifySocketToken: verify,
    } as unknown as AuthService);
    disconnect = jest.fn();
    socket = {
      connected: true,
      handshake: { auth: { token: 'old' } },
      disconnect,
    } as unknown as Socket;
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('expira sockets inactivos y libera sus timers', async () => {
    await service.connect(socket);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('renueva sin desconectar y el timer viejo no cancela acceso nuevo', async () => {
    await service.connect(socket);
    await service.authenticated(socket, () => service.refresh(socket, 'new'));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(disconnect).not.toHaveBeenCalled();
    expect(service.canSend(socket)).toBe(true);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('rechaza cambio de cuenta y conserva vencimiento original', async () => {
    await service.connect(socket);
    await expect(
      service.authenticated(socket, () => service.refresh(socket, 'other')),
    ).rejects.toThrow(UnauthorizedException);
    expect(service.current(socket).user).toEqual(user);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('serializa renovaciones concurrentes y autentica con el token ya reemplazado', async () => {
    await service.connect(socket);
    await Promise.all(
      [1, 2].map(() =>
        service.authenticated(socket, () => service.refresh(socket, 'new')),
      ),
    );
    expect(service.current(socket).token).toBe('new');
    expect(verify.mock.calls.map(([token]) => token)).toEqual([
      'old',
      'old',
      'new',
      'new',
      'new',
    ]);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('no instala credenciales si el acceso anterior vence durante validación', async () => {
    await service.connect(socket);
    verify.mockImplementationOnce(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
      return { user, expiresAt: 120_000 };
    });
    await expect(service.refresh(socket, 'new')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(service.canSend(socket)).toBe(false);
  });
});
