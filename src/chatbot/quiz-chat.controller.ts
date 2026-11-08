import {
  Body,
  Controller,
  Headers,
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
import { chatError } from './chat.errors';
import { QuizChatDto } from './dto/quiz-chat.dto';
import { QuizChatService } from './quiz-chat.service';

@ApiTags('Asistente de cuestionarios')
@ApiBearerAuth()
@Controller('quizzes/:quizId/chat')
export class QuizChatController {
  constructor(private readonly chat: QuizChatService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Prepara o revisa una propuesta V/F sin guardar preguntas',
  })
  @ApiBody({ type: QuizChatDto })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        reply: 'Preparé una pregunta para revisar.',
        draft: {
          questions: [
            { statement: 'El Sol es una estrella', correctBoolean: true },
          ],
        },
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Cinco solicitudes/minuto o una conversación en curso',
  })
  @ApiResponse({
    status: 502,
    description: 'Fallo o respuesta inválida del proveedor',
  })
  @ApiResponse({
    status: 503,
    description: 'Asistente no configurado; autoría manual disponible',
  })
  @ApiResponse({ status: 504, description: 'Plazo agotado' })
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param('quizId', ParseUUIDPipe) quizId: string,
    @Body() dto: QuizChatDto,
    @Headers('content-length') length?: string,
  ) {
    if (Number(length) > 96 * 1024)
      throw chatError(
        413,
        'PAYLOAD_TOO_LARGE',
        'La conversación es demasiado larga.',
      );
    return this.chat.respond(user, quizId, dto);
  }
}
