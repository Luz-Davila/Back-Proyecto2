import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfilesService } from './profiles.service';

const PROFILE_EXAMPLE = {
  userId: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f',
  displayName: 'Ana Pérez',
  createdAt: '2026-10-25T18:00:00.000Z',
  updatedAt: '2026-10-25T18:00:00.000Z',
};

@ApiTags('Perfiles')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Devuelve el perfil del usuario autenticado y lo crea si no existe' })
  @ApiOkResponse({
    description: 'Perfil del usuario',
    schema: { example: PROFILE_EXAMPLE },
  })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getOrCreate(user);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Actualiza el nombre visible del usuario autenticado' })
  @ApiOkResponse({
    description: 'Perfil actualizado',
    schema: { example: { ...PROFILE_EXAMPLE, displayName: 'Ana P.' } },
  })
  @ApiBadRequestResponse({
    description: 'Nombre fuera del rango permitido',
    schema: {
      example: {
        statusCode: 400,
        message: 'displayName must be longer than or equal to 2 characters',
        error: 'Bad Request',
      },
    },
  })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(user, dto);
  }
}
