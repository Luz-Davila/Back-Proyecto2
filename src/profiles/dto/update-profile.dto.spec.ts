import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

async function errorsFor(displayName: unknown): Promise<string[]> {
  const dto = plainToInstance(UpdateProfileDto, { displayName });
  const errors = await validate(dto);
  return errors.map((error) => error.property);
}

describe('UpdateProfileDto', () => {
  it('acepta un nombre entre 2 y 40 caracteres', async () => {
    await expect(errorsFor('Ana')).resolves.toEqual([]);
    await expect(errorsFor('A'.repeat(40))).resolves.toEqual([]);
  });

  it('rechaza un nombre de un solo carácter', async () => {
    await expect(errorsFor('A')).resolves.toEqual(['displayName']);
  });

  it('rechaza un nombre de más de 40 caracteres', async () => {
    await expect(errorsFor('A'.repeat(41))).resolves.toEqual(['displayName']);
  });

  it('recorta los espacios antes de validar', async () => {
    await expect(errorsFor('   Ana   ')).resolves.toEqual([]);
    await expect(errorsFor('   A   ')).resolves.toEqual(['displayName']);
  });

  it('rechaza un valor que no es texto', async () => {
    await expect(errorsFor(12345)).resolves.toEqual(['displayName']);
  });
});
