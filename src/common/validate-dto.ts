import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';

/** También se usa en las herramientas: sus argumentos no pasan por ValidationPipe. */
export async function validateDto<T extends object>(
  type: ClassConstructor<T>,
  value: unknown,
): Promise<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Los datos de la solicitud no son válidos.',
    });
  }
  const dto = plainToInstance(type, value);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  });
  if (errors.length)
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Revisa los mensajes, la cantidad y las preguntas (máximo 30).',
    });
  return dto;
}
