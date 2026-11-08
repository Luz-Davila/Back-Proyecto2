import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { QuestionDraftDto } from './question-draft.dto';

export class CreateQuestionBatchDto extends QuestionDraftDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Conservar al reintentar el mismo lote.',
  })
  @IsUUID()
  operationId: string;
}
