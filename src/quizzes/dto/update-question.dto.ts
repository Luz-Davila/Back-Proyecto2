import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const trimStatement = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateQuestionDto {
  @IsOptional()
  @Transform(trimStatement)
  @IsString()
  @Length(1, 500)
  statement?: string;

  @IsOptional()
  @IsBoolean()
  correctBoolean?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
