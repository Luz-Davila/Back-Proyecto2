import { HttpException } from '@nestjs/common';

export const chatError = (status: number, code: string, message: string) =>
  new HttpException({ code, message }, status);

export const providerError = () =>
  chatError(
    502,
    'CHAT_PROVIDER_ERROR',
    'No se pudo completar la respuesta del asistente. Puedes reintentar.',
  );
export const timeoutError = () =>
  chatError(
    504,
    'CHAT_TIMEOUT',
    'El asistente tardó demasiado. Puedes reintentar.',
  );
