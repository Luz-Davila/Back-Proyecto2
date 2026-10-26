import { detectImageType } from '../quizzes/image-validation';
import { createGradientPng } from './demo-image';

describe('createGradientPng', () => {
  it('genera un PNG válido con la firma correcta', () => {
    const png = createGradientPng(64, 32);

    expect(detectImageType(png)).toBe('image/png');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('respeta las dimensiones solicitadas en la cabecera', () => {
    const png = createGradientPng(640, 360);

    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(360);
  });

  it('produce imágenes de distinto contenido según el tamaño', () => {
    expect(createGradientPng(16, 16).equals(createGradientPng(32, 32))).toBe(false);
  });
});
