import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { assertValidImage, detectImageType } from './image-validation';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);

describe('detectImageType', () => {
  it('detecta PNG, JPEG y WebP por sus bytes iniciales', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(WEBP)).toBe('image/webp');
  });

  it('no reconoce contenido arbitrario', () => {
    expect(detectImageType(Buffer.from('esto no es una imagen'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('assertValidImage', () => {
  const pngFile = { buffer: PNG, mimetype: 'image/png', size: PNG.length };

  it('acepta una imagen PNG válida', () => {
    expect(assertValidImage(pngFile)).toBe('image/png');
  });

  it('acepta JPEG y WebP', () => {
    expect(assertValidImage({ buffer: JPEG, mimetype: 'image/jpeg', size: JPEG.length })).toBe(
      'image/jpeg',
    );
    expect(assertValidImage({ buffer: WEBP, mimetype: 'image/webp', size: WEBP.length })).toBe(
      'image/webp',
    );
  });

  it('rechaza un archivo vacío', () => {
    expect(() => assertValidImage({ buffer: Buffer.alloc(0), mimetype: 'image/png', size: 0 })).toThrow(
      BadRequestException,
    );
  });

  it('rechaza una imagen de más de 2 MB', () => {
    expect(() =>
      assertValidImage({ buffer: PNG, mimetype: 'image/png', size: 2 * 1024 * 1024 + 1 }),
    ).toThrow(PayloadTooLargeException);
  });

  it('rechaza un tipo declarado no permitido', () => {
    expect(() => assertValidImage({ ...pngFile, mimetype: 'image/gif' })).toThrow(BadRequestException);
  });

  it('rechaza un archivo cuyo contenido no es imagen', () => {
    expect(() =>
      assertValidImage({ buffer: Buffer.from('texto plano'), mimetype: 'image/png', size: 11 }),
    ).toThrow(BadRequestException);
  });

  it('rechaza cuando el contenido no coincide con el formato declarado', () => {
    expect(() => assertValidImage({ buffer: JPEG, mimetype: 'image/png', size: JPEG.length })).toThrow(
      /no coincide/,
    );
  });
});
