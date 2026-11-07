import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.service';
import { Profile } from './profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { parseUserRole } from './user-role';

const DEFAULT_DISPLAY_NAME = 'Jugador';
const MAX_DISPLAY_NAME_LENGTH = 40;

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
  ) {}

  async getOrCreate(
    user: AuthenticatedUser,
    manager?: EntityManager,
  ): Promise<Profile> {
    const profiles = manager ? manager.getRepository(Profile) : this.profiles;
    await profiles
      .createQueryBuilder()
      .insert()
      .values({
        userId: user.id,
        displayName: initialDisplayName(user),
        role: parseUserRole(user.appRole) ?? 'student',
      })
      .orIgnore()
      .execute();

    return profiles.findOneByOrFail({ userId: user.id });
  }

  async requireTeacher(
    user: AuthenticatedUser,
    manager?: EntityManager,
  ): Promise<Profile> {
    const profile = await this.getOrCreate(user, manager);
    if (profile.role !== 'teacher') {
      throw new ForbiddenException(
        'Solo el profesor puede crear y dirigir cuestionarios',
      );
    }
    return profile;
  }

  async update(
    user: AuthenticatedUser,
    dto: UpdateProfileDto,
  ): Promise<Profile> {
    await this.getOrCreate(user);
    await this.profiles.update(
      { userId: user.id },
      { displayName: dto.displayName },
    );

    return this.profiles.findOneByOrFail({ userId: user.id });
  }
}

function initialDisplayName(user: AuthenticatedUser): string {
  const fromMetadata = user.displayName?.trim();
  if (fromMetadata && fromMetadata.length >= 2) {
    return fromMetadata.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }

  const fromEmail = user.email?.split('@')[0]?.trim();
  if (fromEmail && fromEmail.length >= 2) {
    return fromEmail.slice(0, MAX_DISPLAY_NAME_LENGTH);
  }

  return DEFAULT_DISPLAY_NAME;
}
