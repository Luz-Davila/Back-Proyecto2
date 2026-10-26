import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const trimStatement = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateQuestionDto {
  @ApiPropertyOptional({ example: 'El sol es una estrella de tipo G', minLength: 1, maxLength: 500 })
  @IsOptional()
  @Transform(trimStatement)
  @IsString()
  @Length(1, 500)
  statement?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  correctBoolean?: boolean;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
