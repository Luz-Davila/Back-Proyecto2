import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateSessionDto } from './dto/create-session.dto';
import { JoinSessionDto } from './dto/join-session.dto';
import { SessionCodeParamsDto } from './dto/session-code-params.dto';
import { SessionRoomsService } from './session-rooms.service';
import {
  JOIN_SESSION_SCHEMA,
  SESSION_ERROR_CATALOG,
  SESSION_ERROR_SCHEMA,
  SESSION_STATE_SCHEMA,
  ROOM_ENVELOPE_SCHEMA,
} from './session.openapi';

@ApiTags('Salas')
@ApiBearerAuth()
@ApiResponse({
  status: 400,
  schema: SESSION_ERROR_SCHEMA,
  description: SESSION_ERROR_CATALOG,
})
@ApiResponse({ status: 401, schema: SESSION_ERROR_SCHEMA })
@ApiResponse({ status: 403, schema: SESSION_ERROR_SCHEMA })
@ApiResponse({ status: 404, schema: SESSION_ERROR_SCHEMA })
@ApiResponse({ status: 409, schema: SESSION_ERROR_SCHEMA })
@ApiResponse({ status: 500, schema: SESSION_ERROR_SCHEMA })
@ApiResponse({ status: 503, schema: SESSION_ERROR_SCHEMA })
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller('sessions')
export class SessionsController {
  constructor(private readonly rooms: SessionRoomsService) {}

  @Post()
  @ApiOperation({
    summary: 'Crea una sala con una copia del cuestionario propio',
  })
  @ApiCreatedResponse({ schema: SESSION_STATE_SCHEMA })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateSessionDto,
  ) {
    return this.rooms.create(user, input);
  }

  @Post('join')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Se une por código o recupera su participación existente',
  })
  @ApiOkResponse({ schema: JOIN_SESSION_SCHEMA })
  join(@CurrentUser() user: AuthenticatedUser, @Body() input: JoinSessionDto) {
    return this.rooms.join(user, input.code);
  }

  @Get(':code/state')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Recupera el snapshot actual por código sin registrar ni suscribir al usuario',
  })
  @ApiOkResponse({ schema: ROOM_ENVELOPE_SCHEMA })
  stateByCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SessionCodeParamsDto,
  ) {
    return this.rooms.stateByCode(user, params.code);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Consulta el estado como host o participante, sin soluciones futuras',
  })
  @ApiOkResponse({ schema: SESSION_STATE_SCHEMA })
  state(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.rooms.state(user, id);
  }

  @Delete(':id/participants/me')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Abandona una sala en espera y libera su participación activa',
  })
  @ApiNoContentResponse()
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.rooms.leave(user, id);
  }
}
