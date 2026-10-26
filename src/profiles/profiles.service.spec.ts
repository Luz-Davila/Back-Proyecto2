import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.service';
import { Profile } from './profile.entity';
import { ProfilesService } from './profiles.service';

const USER_ID = '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f';

describe('ProfilesService', () => {
  let execute: jest.Mock;
  let values: jest.Mock;
  let update: jest.Mock;
  let findOneByOrFail: jest.Mock;
  let service: ProfilesService;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue(undefined);
    values = jest.fn().mockReturnValue({ orIgnore: jest.fn().mockReturnValue({ execute }) });
    update = jest.fn().mockResolvedValue(undefined);
    findOneByOrFail = jest.fn();

    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnValue({ values }),
      }),
      update,
      findOneByOrFail,
    } as unknown as Repository<Profile>;

    service = new ProfilesService(repository);
  });

  function profileFor(displayName: string): Profile {
    return { userId: USER_ID, displayName } as Profile;
  }

  it('crea el perfil con el nombre del metadato de Supabase', async () => {
    const user: AuthenticatedUser = { id: USER_ID, email: 'ana@correo.test', displayName: 'Ana Pérez' };
    findOneByOrFail.mockResolvedValue(profileFor('Ana Pérez'));

    await service.getOrCreate(user);

    expect(values).toHaveBeenCalledWith({ userId: USER_ID, displayName: 'Ana Pérez' });
  });

  it('usa la parte local del correo cuando no hay metadato', async () => {
    const user: AuthenticatedUser = { id: USER_ID, email: 'ana.perez@correo.test' };
    findOneByOrFail.mockResolvedValue(profileFor('ana.perez'));

    await service.getOrCreate(user);

    expect(values).toHaveBeenCalledWith({ userId: USER_ID, displayName: 'ana.perez' });
  });

  it('usa un nombre por defecto cuando no hay metadato ni correo', async () => {
    findOneByOrFail.mockResolvedValue(profileFor('Jugador'));

    await service.getOrCreate({ id: USER_ID });

    expect(values).toHaveBeenCalledWith({ userId: USER_ID, displayName: 'Jugador' });
  });

  it('no sobrescribe un perfil existente al volver a consultarlo', async () => {
    findOneByOrFail.mockResolvedValue(profileFor('Ana'));

    await service.getOrCreate({ id: USER_ID, email: 'otro@correo.test' });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(findOneByOrFail).toHaveBeenCalledWith({ userId: USER_ID });
  });

  it('actualiza solo el perfil del usuario autenticado', async () => {
    findOneByOrFail.mockResolvedValue(profileFor('Ana Nueva'));

    const result = await service.update({ id: USER_ID }, { displayName: 'Ana Nueva' });

    expect(update).toHaveBeenCalledWith({ userId: USER_ID }, { displayName: 'Ana Nueva' });
    expect(result.displayName).toBe('Ana Nueva');
  });
});
