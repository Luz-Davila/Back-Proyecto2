import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { QuestionImagesService } from './question-images.service';
import { Question } from './question.entity';
import { QuestionsService } from './questions.service';

const OWNER: AuthenticatedUser = { id: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f' };
const QUESTION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const QUIZ_ID = '99999999-8888-4777-8666-555555555555';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

function pngFile(): Express.Multer.File {
  return {
    buffer: PNG,
    mimetype: 'image/png',
    size: PNG.length,
    fieldname: 'file',
    originalname: 'foto.png',
    encoding: '7bit',
    destination: '',
    filename: '',
    path: '',
    stream: undefined as never,
  };
}

describe('QuestionImagesService', () => {
  let questions: { findOwned: jest.Mock; updateImageKey: jest.Mock };
  let storage: { upload: jest.Mock; remove: jest.Mock; signedUrl: jest.Mock };
  let service: QuestionImagesService;

  beforeEach(() => {
    questions = {
      findOwned: jest.fn().mockResolvedValue({
        id: QUESTION_ID,
        quizId: QUIZ_ID,
        imageKey: null,
      } as Question),
      updateImageKey: jest.fn().mockResolvedValue(undefined),
    };
    storage = {
      upload: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      signedUrl: jest.fn(async () => 'https://storage.test/firmada'),
    };

    service = new QuestionImagesService(
      questions as unknown as QuestionsService,
      storage as unknown as StorageService,
    );
  });

  it('sube la imagen y guarda la clave generada por el servidor', async () => {
    const result = await service.replace(OWNER, QUESTION_ID, pngFile());

    expect(storage.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^quizzes\/.+\/questions\/[0-9a-f-]{36}\.png$/),
      PNG,
      'image/png',
    );
    const key = questions.updateImageKey.mock.calls[0][1];
    expect(key).toMatch(/^quizzes\/.+\/questions\/[0-9a-f-]{36}\.png$/);
    expect(result.imageKey).toBe(key);
    expect(result.imageUrl).toBe('https://storage.test/firmada');
  });

  it('no conserva el nombre original del archivo', async () => {
    await service.replace(OWNER, QUESTION_ID, pngFile());

    const key = questions.updateImageKey.mock.calls[0][1];
    expect(key).not.toContain('foto.png');
  });

  it('borra la imagen anterior al reemplazarla', async () => {
    questions.findOwned.mockResolvedValue({
      id: QUESTION_ID,
      quizId: QUIZ_ID,
      imageKey: 'quizzes/viejo/questions/vieja.png',
    } as Question);

    await service.replace(OWNER, QUESTION_ID, pngFile());

    expect(storage.remove).toHaveBeenCalledWith('quizzes/viejo/questions/vieja.png');
  });

  it('rechaza la carga sin archivo', async () => {
    await expect(service.replace(OWNER, QUESTION_ID, undefined)).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rechaza un archivo que no es imagen antes de subirlo', async () => {
    const fake = { ...pngFile(), buffer: Buffer.from('no soy imagen'), mimetype: 'image/png' };

    await expect(service.replace(OWNER, QUESTION_ID, fake)).rejects.toThrow(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('no permite cargar imágenes en preguntas de otro usuario', async () => {
    questions.findOwned.mockRejectedValue(new ForbiddenException('ajena'));

    await expect(service.replace(OWNER, QUESTION_ID, pngFile())).rejects.toThrow(ForbiddenException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('elimina la imagen y limpia la clave', async () => {
    questions.findOwned.mockResolvedValue({
      id: QUESTION_ID,
      quizId: QUIZ_ID,
      imageKey: 'quizzes/q/questions/x.png',
    } as Question);

    await service.remove(OWNER, QUESTION_ID);

    expect(storage.remove).toHaveBeenCalledWith('quizzes/q/questions/x.png');
    expect(questions.updateImageKey).toHaveBeenCalledWith(QUESTION_ID, null);
  });

  it('responde 404 al eliminar una pregunta sin imagen', async () => {
    await expect(service.remove(OWNER, QUESTION_ID)).rejects.toThrow(NotFoundException);
  });
});
