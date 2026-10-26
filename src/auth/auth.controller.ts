import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.service';

@ApiTags('Perfiles')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Devuelve los datos del token de Supabase ya validado' })
  @ApiOkResponse({
    description: 'Usuario del token',
    schema: {
      example: {
        id: '6f1c2b1e-8d2a-4c3b-9e1f-0a1b2c3d4e5f',
        email: 'ana@test.com',
        role: 'authenticated',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
