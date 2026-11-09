import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { QUESTION_KINDS } from '../question-kind';

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

  @ApiPropertyOptional({
    enum: QUESTION_KINDS,
    example: 'boolean',
    description: 'boolean = verdadero/falso. multiple = 4 opciones, una o más correctas.',
  })
  @IsOptional()
  @IsIn(QUESTION_KINDS)
  kind?: (typeof QUESTION_KINDS)[number];

  @ApiPropertyOptional({ example: true, description: 'Obligatoria si kind es boolean' })
  @ValidateIf((dto: CreateQuestionDto) => (dto.kind ?? 'boolean') === 'boolean')
  @IsBoolean()
  correctBoolean?: boolean;

  @ApiPropertyOptional({
    example: ['Mercurio', 'Venus', 'Tierra', 'Marte'],
    description: 'Las 4 opciones si kind es multiple',
  })
  @ValidateIf((dto: CreateQuestionDto) => dto.kind === 'multiple')
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  options?: string[];

  @ApiPropertyOptional({
    example: [2],
    description: 'Índices 0-3 de las opciones correctas. Al menos una.',
  })
  @ValidateIf((dto: CreateQuestionDto) => dto.kind === 'multiple')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(3, { each: true })
  correctIndexes?: number[];

  @ApiPropertyOptional({
    example: 20,
    description: 'Segundos para responder esta pregunta. Si se omite, la sala usa su tiempo por defecto.',
    minimum: 5,
    maximum: 120,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  durationSeconds?: number | null;

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
