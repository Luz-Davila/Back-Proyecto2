import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateQuestionBatchDto } from './dto/create-question-batch.dto';
import { QuestionBatchesService } from './question-batches.service';

@ApiTags('Preguntas')
@ApiBearerAuth()
@Controller('quizzes/:quizId/questions/batch')
export class QuestionBatchesController {
  constructor(private readonly batches: QuestionBatchesService) {}

  @Post()
  @HttpCode(200)
  @ApiBody({ type: CreateQuestionBatchDto })
  @ApiOperation({
    summary: 'Agrega 1–30 preguntas aprobadas, en una transacción idempotente',
  })
  @ApiResponse({
    status: 200,
    description:
      'Recibo original o replay con las preguntas e identificadores asignados',
  })
  @ApiResponse({
    status: 400,
    description: 'Enunciado, booleano, cantidad o UUID inválido',
  })
  @ApiResponse({ status: 403, description: 'Solo profesores' })
  @ApiResponse({ status: 404, description: 'Cuestionario inexistente o ajeno' })
  @ApiResponse({
    status: 409,
    description: 'operationId ya utilizado con otro contenido',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @Body() dto: CreateQuestionBatchDto,
  ) {
    return this.batches.create(user, quizId, dto);
  }
}
