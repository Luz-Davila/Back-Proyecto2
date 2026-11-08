import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DraftQuestionDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'El Sol es una estrella',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500)
  statement: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  correctBoolean: boolean;
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
