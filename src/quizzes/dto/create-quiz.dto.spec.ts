import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQuizDto } from './create-quiz.dto';

async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateQuizDto, payload);
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('CreateQuizDto', () => {
  it('acepta un título y una descripción válidos', async () => {
    await expect(errorsFor({ title: 'Quiz de animales', description: 'Preguntas básicas' })).resolves.toEqual(
      [],
    );
  });

  it('acepta un título sin descripción', async () => {
    await expect(errorsFor({ title: 'Quiz de animales' })).resolves.toEqual([]);
  });

  it('rechaza un título demasiado corto', async () => {
    await expect(errorsFor({ title: 'ab' })).resolves.toEqual(['title']);
  });

  it('rechaza un título vacío o solo espacios', async () => {
    await expect(errorsFor({ title: '   ' })).resolves.toEqual(['title']);
  });

  it('rechaza una descripción de más de 500 caracteres', async () => {
    await expect(
      errorsFor({ title: 'Quiz válido', description: 'a'.repeat(501) }),
    ).resolves.toEqual(['description']);
  });

  it('rechaza un título que no es texto', async () => {
    await expect(errorsFor({ title: 123 })).resolves.toEqual(['title']);
  });
});
