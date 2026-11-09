import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { QuizImagesService } from './quiz-images.service';
import { Quiz } from './quiz.entity';
import { QuizzesService } from './quizzes.service';

const OWNER: AuthenticatedUser = { id: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f' };
const QUIZ_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

function pngFile(): Express.Multer.File {
  return {
    buffer: PNG,
    mimetype: 'image/png',
    size: PNG.length,
    fieldname: 'file',
    originalname: 'portada.png',
    encoding: '7bit',
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
  };
}

describe('QuizImagesService', () => {
  let quizzes: { findOwned: jest.Mock; updateImageKey: jest.Mock };
  let storage: { upload: jest.Mock; remove: jest.Mock; signedUrl: jest.Mock };
  let service: QuizImagesService;

  beforeEach(() => {
    quizzes = {
      findOwned: jest.fn().mockResolvedValue({
        id: QUIZ_ID,
        imageKey: null,
      } as Quiz),
      updateImageKey: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      signedUrl: jest.fn(async () => 'https://storage.test/firmada'),
    };

    service = new QuizImagesService(
      quizzes as unknown as QuizzesService,
      storage as unknown as StorageService,
    );
  });

  it('sube la imagen y guarda la clave generada por el servidor', async () => {
    const result = await service.replace(OWNER, QUIZ_ID, pngFile());

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^quizzes\/.+\/cover\/[0-9a-f-]{36}\.png$/),
      PNG,
      'image/png',
    );
    const key = quizzes.updateImageKey.mock.calls[0][1];
    expect(key).toMatch(/^quizzes\/.+\/cover\/[0-9a-f-]{36}\.png$/);
    expect(result.imageKey).toBe(key);
    expect(result.imageUrl).toBe('https://storage.test/firmada');
  });

  it('borra la imagen anterior al reemplazarla', async () => {
    quizzes.findOwned.mockResolvedValue({
      id: QUIZ_ID,
      imageKey: 'quizzes/viejo/cover/vieja.png',
    } as Quiz);

    await service.replace(OWNER, QUIZ_ID, pngFile());

    expect(storage.remove).toHaveBeenCalledWith('quizzes/viejo/cover/vieja.png');
  });

  it('rechaza la carga sin archivo', async () => {
    await expect(service.replace(OWNER, QUIZ_ID, undefined)).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('no permite cargar imágenes en cuestionarios de otro usuario', async () => {
    quizzes.findOwned.mockRejectedValue(new ForbiddenException('ajena'));

    await expect(service.replace(OWNER, QUIZ_ID, pngFile())).rejects.toThrow(ForbiddenException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('elimina la imagen y limpia la clave', async () => {
    quizzes.findOwned.mockResolvedValue({
      id: QUIZ_ID,
      imageKey: 'quizzes/q/cover/x.png',
    } as Quiz);

    await service.remove(OWNER, QUIZ_ID);

    expect(storage.remove).toHaveBeenCalledWith('quizzes/q/cover/x.png');
    expect(quizzes.updateImageKey).toHaveBeenCalledWith(QUIZ_ID, null);
  });

  it('responde 404 al eliminar un cuestionario sin imagen', async () => {
    await expect(service.remove(OWNER, QUIZ_ID)).rejects.toThrow(NotFoundException);
  });
});
