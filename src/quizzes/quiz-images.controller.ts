import {
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { MAX_IMAGE_BYTES } from './image-validation';
import { QuizImagesService } from './quiz-images.service';

@ApiTags('Imágenes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
@Controller('quizzes/:id/image')
export class QuizImagesController {
  constructor(private readonly images: QuizImagesService) {}

  @Put()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiOperation({ summary: 'Carga o reemplaza la imagen de un cuestionario' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Imagen cargada; devuelve la clave y una URL firmada temporal',
    schema: {
      example: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        imageKey: 'quizzes/aaaaaaaa/cover/3f2b1c9e.png',
        imageUrl: 'https://proyecto.supabase.co/storage/v1/object/sign/...',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Archivo ausente, formato no permitido o contenido que no coincide',
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera los 2 MB' })
  @ApiForbiddenResponse({ description: 'El cuestionario pertenece a otro usuario' })
  @ApiNotFoundResponse({ description: 'El cuestionario no existe' })
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.images.replace(user, id, file);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina la imagen de un cuestionario del almacenamiento' })
  @ApiNoContentResponse({ description: 'Imagen eliminada' })
  @ApiNotFoundResponse({ description: 'El cuestionario no existe o no tiene imagen' })
  @ApiForbiddenResponse({ description: 'El cuestionario pertenece a otro usuario' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.images.remove(user, id);
  }
}
