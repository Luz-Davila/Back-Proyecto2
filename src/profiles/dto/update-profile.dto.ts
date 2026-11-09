import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { OWL_AVATAR_IDS, type OwlAvatarId } from '../owl-avatar';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Ana Pérez', minLength: 2, maxLength: 40 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 40)
  displayName: string;

  @ApiPropertyOptional({ enum: OWL_AVATAR_IDS, example: 'book' })
  @IsOptional()
  @IsIn(OWL_AVATAR_IDS)
  avatarId?: OwlAvatarId;
}
