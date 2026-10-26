import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class UpdateQuizDto {
  @ApiPropertyOptional({ example: 'Animales del bosque (repaso)', minLength: 3, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title?: string;

  @ApiPropertyOptional({ example: 'Actualizado para la clase del martes', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;
}
