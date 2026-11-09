import { ApiPropertyOptional } from '@nestjs/swagger';
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

export class UpdateQuestionDto {
  @ApiPropertyOptional({ example: 'El sol es una estrella de tipo G', minLength: 1, maxLength: 500 })
  @IsOptional()
  @Transform(trimStatement)
  @IsString()
  @Length(1, 500)
  statement?: string;

  @ApiPropertyOptional({ enum: QUESTION_KINDS, example: 'multiple' })
  @IsOptional()
  @IsIn(QUESTION_KINDS)
  kind?: (typeof QUESTION_KINDS)[number];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  correctBoolean?: boolean;

  @ApiPropertyOptional({ example: ['Mercurio', 'Venus', 'Tierra', 'Marte'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  options?: string[];

  @ApiPropertyOptional({ example: [0, 2], description: 'Índices 0-3 de las opciones correctas' })
  @IsOptional()
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
    description: 'Segundos para responder. null vuelve al tiempo por defecto de la sala.',
    minimum: 5,
    maximum: 120,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(5)
  @Max(120)
  durationSeconds?: number | null;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
