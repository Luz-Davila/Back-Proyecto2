import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service';
import { ProfilesService } from '../profiles/profiles.service';
import { StorageService } from '../storage/storage.service';
import { Quiz } from './quiz.entity';
import { QuizzesService } from './quizzes.service';

const OWNER: AuthenticatedUser = { id: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f', email: 'ana@test.com' };
const OTHER: AuthenticatedUser = { id: '11111111-2222-4333-8444-555555555555', email: 'luis@test.com' };
const QUIZ_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('QuizzesService', () => {
  let repository: {
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    remove: jest.Mock;
  };
  let profiles: { getOrCreate: jest.Mock };
  let storage: { signedUrl: jest.Mock };
  let service: QuizzesService;

  beforeEach(() => {
    const chain = {
      where: jest.fn().mockReturnThis(),
      loadRelationCountAndMap: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repository = {
      createQueryBuilder: jest.fn().mockReturnValue(chain),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      remove: jest.fn(),
    };

    profiles = { getOrCreate: jest.fn().mockResolvedValue({ userId: OWNER.id }) };
    storage = { signedUrl: jest.fn(async (key: string) => `https://storage.test/${key}`) };
    service = new QuizzesService(
      repository as unknown as Repository<Quiz>,
      profiles as unknown as ProfilesService,
      storage as unknown as StorageService,
    );
  });

  function quizOf(ownerId: string): Quiz {
    return {
      id: QUIZ_ID,
      ownerId,
      title: 'Quiz de prueba',
      description: null,
      questions: [],
    } as unknown as Quiz;
  }

  it('crea el cuestionario con el dueño del token', async () => {
    await service.create(OWNER, { title: 'Quiz de prueba' });

    expect(profiles.getOrCreate).toHaveBeenCalledWith(OWNER);
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: OWNER.id, title: 'Quiz de prueba' }),
    );
  });

  it('lista solo los cuestionarios del usuario', async () => {
    await service.list(OWNER);

    const chain = repository.createQueryBuilder.mock.results[0].value;
    expect(chain.where).toHaveBeenCalledWith('quiz.ownerId = :ownerId', { ownerId: OWNER.id });
  });

  it('devuelve el cuestionario propio con sus preguntas ordenadas', async () => {
    repository.findOne.mockResolvedValue(quizOf(OWNER.id));

    await expect(service.findOne(OWNER, QUIZ_ID)).resolves.toMatchObject({ id: QUIZ_ID });
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: QUIZ_ID, ownerId: OWNER.id } }),
    );
  });

  it('no revela el cuestionario de otro usuario al leerlo', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findOne(OTHER, QUIZ_ID)).rejects.toThrow(NotFoundException);
  });

  it('responde 404 al leer un cuestionario inexistente', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(service.findOne(OWNER, QUIZ_ID)).rejects.toThrow(NotFoundException);
  });

  it('actualiza el cuestionario propio', async () => {
    repository.findOneBy.mockResolvedValue(quizOf(OWNER.id));

    await service.update(OWNER, QUIZ_ID, { title: 'Título nuevo', description: 'Detalle' });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Título nuevo', description: 'Detalle' }),
    );
  });

  it('rechaza modificar el cuestionario de otro usuario', async () => {
    repository.findOneBy.mockResolvedValue(quizOf(OWNER.id));

    await expect(service.update(OTHER, QUIZ_ID, { title: 'Robado' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('responde 404 al modificar un cuestionario inexistente', async () => {
    repository.findOneBy.mockResolvedValue(null);

    await expect(service.update(OWNER, QUIZ_ID, { title: 'Nuevo' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('elimina el cuestionario propio', async () => {
    repository.findOneBy.mockResolvedValue(quizOf(OWNER.id));

    await service.remove(OWNER, QUIZ_ID);

    expect(repository.remove).toHaveBeenCalledWith(expect.objectContaining({ id: QUIZ_ID }));
  });

  it('rechaza eliminar el cuestionario de otro usuario', async () => {
    repository.findOneBy.mockResolvedValue(quizOf(OWNER.id));

    await expect(service.remove(OTHER, QUIZ_ID)).rejects.toThrow(ForbiddenException);
    expect(repository.remove).not.toHaveBeenCalled();
  });
});
