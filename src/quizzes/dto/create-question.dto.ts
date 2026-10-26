import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

const trimStatement = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateQuestionDto {
  @ApiProperty({
    example: 'El sol es una estrella',
    minLength: 1,
    maxLength: 500,
  })
  @Transform(trimStatement)
  @IsString()
  @Length(1, 500)
  statement: string;

  @ApiProperty({ example: true, description: 'Respuesta correcta de la pregunta' })
  @IsBoolean()
  correctBoolean: boolean;

  @ApiPropertyOptional({
    example: 0,
    description: 'Posición en el cuestionario. Si se omite, se agrega al final.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
