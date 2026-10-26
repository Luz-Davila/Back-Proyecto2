import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 40)
  displayName: string;
}
