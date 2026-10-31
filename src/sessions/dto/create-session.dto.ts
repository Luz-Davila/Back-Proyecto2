import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsUUID, Min, Max } from 'class-validator';
import {
  DEFAULT_QUESTION_DURATION_SECONDS,
  DEFAULT_REVIEW_DURATION_SECONDS,
  MIN_QUESTION_DURATION_SECONDS,
  MAX_QUESTION_DURATION_SECONDS,
  MIN_REVIEW_DURATION_SECONDS,
  MAX_REVIEW_DURATION_SECONDS,
} from '../session.contracts';
import type {
  CreateSessionInput,
  QuestionDurationSeconds,
} from '../session.contracts';

export class CreateSessionDto implements CreateSessionInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  quizId: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: MIN_QUESTION_DURATION_SECONDS,
    maximum: MAX_QUESTION_DURATION_SECONDS,
    default: DEFAULT_QUESTION_DURATION_SECONDS,
  })
  @IsInt()
  @Min(MIN_QUESTION_DURATION_SECONDS)
  @Max(MAX_QUESTION_DURATION_SECONDS)
  questionDurationSeconds: QuestionDurationSeconds =
    DEFAULT_QUESTION_DURATION_SECONDS;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: MIN_REVIEW_DURATION_SECONDS,
    maximum: MAX_REVIEW_DURATION_SECONDS,
    default: DEFAULT_REVIEW_DURATION_SECONDS,
  })
  @IsInt()
  @Min(MIN_REVIEW_DURATION_SECONDS)
  @Max(MAX_REVIEW_DURATION_SECONDS)
  reviewDurationSeconds: number = DEFAULT_REVIEW_DURATION_SECONDS;
}
