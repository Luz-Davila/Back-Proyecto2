import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../auth/auth.service';
import { Profile } from './profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';

const DEFAULT_DISPLAY_NAME = 'Jugador';
const MAX_DISPLAY_NAME_LENGTH = 40;

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile)
    private readonly profiles: Repository<Profile>,
  ) {}

  async getOrCreate(user: AuthenticatedUser): Promise<Profile> {
    await this.profiles
      .createQueryBuilder()
      .insert()
      .values({ userId: user.id, displayName: initialDisplayName(user) })
      .orIgnore()
      .execute();

    return this.profiles.findOneByOrFail({ userId: user.id });
  }

  async update(user: AuthenticatedUser, dto: UpdateProfileDto): Promise<Profile> {
    await this.getOrCreate(user);
    await this.profiles.update({ userId: user.id }, { displayName: dto.displayName });

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
