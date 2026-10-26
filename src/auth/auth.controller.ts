import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from './current-user.decorator';
import type { AuthenticatedUser } from './auth.service';

@Controller('auth')
export class AuthController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
