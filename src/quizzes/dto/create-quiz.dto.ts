import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateQuizDto {
  @ApiProperty({ example: 'Animales del bosque', minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title: string;

  @ApiPropertyOptional({
    example: 'Repaso corto para el final de la clase',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;
}
