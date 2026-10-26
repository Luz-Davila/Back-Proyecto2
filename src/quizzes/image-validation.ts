import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_FILE_SIZE } from '../storage/bucket-config';

export const MAX_IMAGE_BYTES = MAX_IMAGE_FILE_SIZE;
export const ALLOWED_IMAGE_TYPES = ALLOWED_IMAGE_MIME_TYPES as readonly AllowedImageType[];

export type AllowedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const EXTENSIONS: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/**
 * Detecta el formato real por los primeros bytes del archivo, sin confiar en
 * la extensión ni en el nombre original.
 */
export function detectImageType(buffer: Buffer): AllowedImageType | null {
  if (buffer.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    return 'image/png';
  }
  if (buffer.length >= JPEG_SIGNATURE.length && JPEG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function extensionFor(type: AllowedImageType): string {
  return EXTENSIONS[type];
}

export function assertValidImage(file: { buffer: Buffer; mimetype: string; size: number }): AllowedImageType {
  if (file.size === 0) {
    throw new BadRequestException('El archivo está vacío');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeException('La imagen supera el máximo de 2 MB');
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype as AllowedImageType)) {
    throw new BadRequestException('Formato no permitido. Usa JPG, PNG o WebP');
  }

  const detected = detectImageType(file.buffer);
  if (!detected) {
    throw new BadRequestException('El archivo no es una imagen válida');
  }
  if (detected !== file.mimetype) {
    throw new BadRequestException('El contenido del archivo no coincide con el formato declarado');
  }

  return detected;
}
