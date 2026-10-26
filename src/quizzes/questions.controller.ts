import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionsService } from './questions.service';

const QUESTION_EXAMPLE = {
  id: '11111111-2222-4333-8444-555555555555',
  quizId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  statement: 'El sol es una estrella',
  correctBoolean: true,
  imageKey: null,
  position: 0,
  createdAt: '2026-10-25T18:00:00.000Z',
  updatedAt: '2026-10-25T18:00:00.000Z',
};

@ApiTags('Preguntas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
@Controller('quizzes/:quizId/questions')
export class QuizQuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Post()
  @ApiOperation({ summary: 'Agrega una pregunta al final o en la posición indicada' })
  @ApiCreatedResponse({ description: 'Pregunta creada', schema: { example: QUESTION_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Enunciado inválido, respuesta no booleana o posición fuera de rango',
    schema: {
      example: {
        statusCode: 400,
        message: 'correctBoolean must be a boolean value',
        error: 'Bad Request',
      },
    },
  })
  @ApiForbiddenResponse({ description: 'El cuestionario pertenece a otro usuario' })
  @ApiNotFoundResponse({ description: 'El cuestionario no existe' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questions.create(user, quizId, dto);
  }
}

@ApiTags('Preguntas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza el enunciado, la respuesta o la posición de una pregunta' })
  @ApiOkResponse({ description: 'Pregunta actualizada', schema: { example: QUESTION_EXAMPLE } })
  @ApiForbiddenResponse({ description: 'La pregunta pertenece a otro usuario' })
  @ApiNotFoundResponse({ description: 'La pregunta no existe' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.questions.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina una pregunta y renumera las restantes' })
  @ApiNoContentResponse({ description: 'Pregunta eliminada' })
  @ApiForbiddenResponse({ description: 'La pregunta pertenece a otro usuario' })
  @ApiNotFoundResponse({ description: 'La pregunta no existe' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.questions.remove(user, id);
  }
}
