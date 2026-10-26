import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service';
import { Question } from './question.entity';
import { QuestionsService } from './questions.service';
import { Quiz } from './quiz.entity';

const OWNER: AuthenticatedUser = { id: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f' };
const OTHER: AuthenticatedUser = { id: '11111111-2222-4333-8444-555555555555' };
const QUIZ_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

class FakeQuestionStore {
  rows: Question[] = [];
  private nextId = 1;

  async find({ where }: { where: { quizId: string } }): Promise<Question[]> {
    return this.rows
      .filter((row) => row.quizId === where.quizId)
      .sort((a, b) => a.position - b.position);
  }

  async findOne(): Promise<Question | null> {
    return null;
  }

  create(value: Partial<Question>): Question {
    return { ...value, id: `pregunta-${this.nextId++}` } as Question;
  }

  async save(question: Question): Promise<Question> {
    const index = this.rows.findIndex((item) => item.id === question.id);
    if (index >= 0) {
      this.rows[index] = question;
    } else {
      this.rows.push(question);
    }
    return question;
  }

  async update(criteria: { id: string }, patch: Partial<Question>): Promise<void> {
    const row = this.rows.find((item) => item.id === criteria.id);
    if (row) {
      Object.assign(row, patch);
    }
  }

  async remove(question: Question): Promise<void> {
    this.rows = this.rows.filter((item) => item.id !== question.id);
  }

  seed(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.rows.push({
        id: `pregunta-${this.nextId++}`,
        quizId: QUIZ_ID,
        statement: `Enunciado ${index}`,
        correctBoolean: true,
        imageKey: null,
        position: index,
      } as Question);
    }
  }
}

describe('QuestionsService', () => {
  let store: FakeQuestionStore;
  let quizzes: { findOneBy: jest.Mock };
  let service: QuestionsService;

  beforeEach(() => {
    store = new FakeQuestionStore();
    quizzes = { findOneBy: jest.fn().mockResolvedValue({ id: QUIZ_ID, ownerId: OWNER.id } as Quiz) };

    const dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => unknown) =>
        callback({ getRepository: () => store }),
      ),
    };

    service = new QuestionsService(
      {
        findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
          const row = store.rows.find((item) => item.id === where.id);
          if (!row) {
            return null;
          }
          const withQuiz = row as Question & { quiz?: { ownerId: string } };
          return { ...withQuiz, quiz: withQuiz.quiz ?? { ownerId: OWNER.id } };
        }),
      } as unknown as Repository<Question>,
      quizzes as unknown as Repository<Quiz>,
      dataSource as unknown as DataSource,
    );
  });

  function positions(): number[] {
    return store.rows
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((row) => row.position);
  }

  it('agrega la pregunta al final cuando no se indica posición', async () => {
    store.seed(2);

    const created = await service.create(OWNER, QUIZ_ID, {
      statement: 'El cielo es azul',
      correctBoolean: true,
    });

    expect(created.position).toBe(2);
    expect(positions()).toEqual([0, 1, 2]);
    expect(store.rows.at(-1)?.statement).toBe('El cielo es azul');
  });

  it('inserta la pregunta en la posición indicada y renumera el resto', async () => {
    store.seed(3);

    const created = await service.create(OWNER, QUIZ_ID, {
      statement: 'Primera',
      correctBoolean: false,
      position: 0,
    });

    expect(positions()).toEqual([0, 1, 2, 3]);
    expect(store.rows.find((row) => row.position === 0)?.id).toBe(created.id);
  });

  it('rechaza una posición mayor que la cantidad de preguntas', async () => {
    store.seed(1);

    await expect(
      service.create(OWNER, QUIZ_ID, { statement: 'Fuera', correctBoolean: true, position: 5 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza crear preguntas en el cuestionario de otro usuario', async () => {
    quizzes.findOneBy.mockResolvedValue({ id: QUIZ_ID, ownerId: OTHER.id } as Quiz);

    await expect(
      service.create(OWNER, QUIZ_ID, { statement: 'Intruso', correctBoolean: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(store.rows).toHaveLength(0);
  });

  it('responde 404 si el cuestionario no existe', async () => {
    quizzes.findOneBy.mockResolvedValue(null);

    await expect(
      service.create(OWNER, QUIZ_ID, { statement: 'Sin quiz', correctBoolean: true }),
    ).rejects.toThrow(NotFoundException);
  });

  it('actualiza enunciado y respuesta de una pregunta propia', async () => {
    store.seed(2);
    const question = store.rows[0];

    const updated = await service.update(OWNER, question.id, {
      statement: 'Enunciado corregido',
      correctBoolean: false,
    });

    expect(updated.statement).toBe('Enunciado corregido');
    expect(store.rows[0].correctBoolean).toBe(false);
  });

  it('mueve la pregunta y renumera las posiciones', async () => {
    store.seed(3);
    const last = store.rows[2];

    const updated = await service.update(OWNER, last.id, { position: 0 });

    expect(updated.position).toBe(0);
    expect(positions()).toEqual([0, 1, 2]);
    expect(store.rows.find((row) => row.position === 0)?.id).toBe(last.id);
  });

  it('rechaza mover una pregunta a una posición fuera de rango', async () => {
    store.seed(2);

    await expect(service.update(OWNER, store.rows[0].id, { position: 9 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza modificar preguntas de otro usuario', async () => {
    store.seed(1);
    (store.rows[0] as unknown as { quiz: unknown }).quiz = { ownerId: OTHER.id };

    await expect(service.update(OWNER, store.rows[0].id, { statement: 'Robado' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('elimina la pregunta y renumera las restantes desde cero', async () => {
    store.seed(3);
    const first = store.rows[0];
    (first as unknown as { quiz: unknown }).quiz = { ownerId: OWNER.id };

    await service.remove(OWNER, first.id);

    expect(store.rows).toHaveLength(2);
    expect(positions()).toEqual([0, 1]);
  });

  it('responde 404 al modificar una pregunta inexistente', async () => {
    await expect(service.update(OWNER, 'pregunta-inexistente', { statement: 'X' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
