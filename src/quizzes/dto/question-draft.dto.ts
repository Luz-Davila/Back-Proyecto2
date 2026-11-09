import { Transform, Type } from 'class-transformer';
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
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QUESTION_KINDS } from '../question-kind';

const trimText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class DraftQuestionDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'El Sol es una estrella',
  })
  @Transform(trimText)
  @IsString()
  @Length(1, 500)
  statement: string;

  @ApiPropertyOptional({
    enum: QUESTION_KINDS,
    example: 'boolean',
    description: 'boolean = verdadero/falso. multiple = 4 opciones.',
  })
  @Transform(({ value, obj }: { value: unknown; obj: { options?: unknown } }) => {
    if (value === 'multiple' || value === 'boolean') return value;
    return Array.isArray(obj.options) ? 'multiple' : value;
  })
  @IsOptional()
  @IsIn(QUESTION_KINDS)
  kind?: (typeof QUESTION_KINDS)[number];

  @ApiPropertyOptional({ example: true })
  @ValidateIf((dto: DraftQuestionDto) => (dto.kind ?? 'boolean') === 'boolean')
  @IsBoolean()
  correctBoolean?: boolean;

  @ApiPropertyOptional({
    example: ['Mercurio', 'Venus', 'Tierra', 'Marte'],
  })
  @ValidateIf((dto: DraftQuestionDto) => dto.kind === 'multiple')
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item.trim() : item)) : value,
  )
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  options?: string[];

  @ApiPropertyOptional({ example: [2] })
  @ValidateIf((dto: DraftQuestionDto) => dto.kind === 'multiple')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(3, { each: true })
  correctIndexes?: number[];
}

export class QuestionDraftDto {
  @ApiProperty({ type: [DraftQuestionDto], minItems: 1, maxItems: 30 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DraftQuestionDto)
  questions: DraftQuestionDto[];
}
