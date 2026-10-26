import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQuestionDto } from './create-question.dto';

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateQuestionDto, payload);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('CreateQuestionDto', () => {
  it('acepta un enunciado y un booleano', async () => {
    await expect(errorsFor({ statement: 'La tierra es redonda', correctBoolean: true })).resolves.toEqual(
      [],
    );
  });

  it('acepta la respuesta falsa', async () => {
    await expect(errorsFor({ statement: 'El sol es frío', correctBoolean: false })).resolves.toEqual([]);
  });

  it('rechaza un enunciado vacío', async () => {
    await expect(errorsFor({ statement: '   ', correctBoolean: true })).resolves.toEqual(['statement']);
  });

  it('rechaza un enunciado de más de 500 caracteres', async () => {
    await expect(errorsFor({ statement: 'a'.repeat(501), correctBoolean: true })).resolves.toEqual([
      'statement',
    ]);
  });

  it('rechaza la respuesta escrita como texto', async () => {
    await expect(errorsFor({ statement: 'Enunciado', correctBoolean: 'true' })).resolves.toEqual([
      'correctBoolean',
    ]);
  });

  it('rechaza una posición negativa o decimal', async () => {
    await expect(errorsFor({ statement: 'Enunciado', correctBoolean: true, position: -1 })).resolves.toEqual(
      ['position'],
    );
    await expect(errorsFor({ statement: 'Enunciado', correctBoolean: true, position: 1.5 })).resolves.toEqual(
      ['position'],
    );
  });
});
