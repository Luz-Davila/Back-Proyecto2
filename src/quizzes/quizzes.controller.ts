import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { QuizzesService } from './quizzes.service';

const QUIZ_EXAMPLE = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  ownerId: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f',
  title: 'Animales del bosque',
  description: 'Repaso corto para el final de la clase',
  createdAt: '2026-10-25T18:00:00.000Z',
  updatedAt: '2026-10-25T18:00:00.000Z',
};

@ApiTags('Cuestionarios')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
@Controller('quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista los cuestionarios del usuario autenticado' })
  @ApiOkResponse({
    description: 'Cuestionarios propios, con la cantidad de preguntas',
    schema: { example: [{ ...QUIZ_EXAMPLE, questionsCount: 3 }] },
  })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.quizzes.list(user);
  }

  @Post()
  @ApiOperation({ summary: 'Crea un cuestionario' })
  @ApiCreatedResponse({ description: 'Cuestionario creado', schema: { example: QUIZ_EXAMPLE } })
  @ApiBadRequestResponse({
    description: 'Título o descripción inválidos',
    schema: {
      example: {
        statusCode: 400,
        message: 'title must be longer than or equal to 3 characters',
        error: 'Bad Request',
      },
    },
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuizDto) {
    return this.quizzes.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Devuelve un cuestionario propio con sus preguntas ordenadas' })
  @ApiOkResponse({
    description: 'Detalle del cuestionario con las preguntas y la URL firmada de su imagen',
    schema: {
      example: {
        ...QUIZ_EXAMPLE,
        questions: [
          {
            id: '11111111-2222-4333-8444-555555555555',
            quizId: QUIZ_EXAMPLE.id,
            statement: 'El sol es una estrella',
            correctBoolean: true,
            imageKey: null,
            imageUrl: null,
            position: 0,
          },
        ],
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'No existe o pertenece a otro usuario',
    schema: {
      example: { statusCode: 404, message: 'Cuestionario no encontrado', error: 'Not Found' },
    },
  })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.quizzes.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza un cuestionario propio' })
  @ApiOkResponse({ description: 'Cuestionario actualizado', schema: { example: QUIZ_EXAMPLE } })
  @ApiForbiddenResponse({
    description: 'El cuestionario pertenece a otro usuario',
    schema: {
      example: {
        statusCode: 403,
        message: 'No puedes modificar un cuestionario de otro usuario',
        error: 'Forbidden',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'El cuestionario no existe' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuizDto,
  ) {
    return this.quizzes.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina un cuestionario propio junto con sus preguntas' })
  @ApiNoContentResponse({ description: 'Cuestionario eliminado' })
  @ApiForbiddenResponse({ description: 'El cuestionario pertenece a otro usuario' })
  @ApiNotFoundResponse({ description: 'El cuestionario no existe' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.quizzes.remove(user, id);
  }
}
