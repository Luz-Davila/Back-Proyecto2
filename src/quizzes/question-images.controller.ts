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
import { QuestionImagesService } from './question-images.service';

@ApiTags('Imágenes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado' })
@Controller('questions/:id/image')
export class QuestionImagesController {
  constructor(private readonly images: QuestionImagesService) {}

  @Put()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  @ApiOperation({ summary: 'Carga o reemplaza la imagen de una pregunta' })
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
        id: '11111111-2222-4333-8444-555555555555',
        imageKey: 'quizzes/aaaaaaaa/questions/3f2b1c9e.png',
        imageUrl: 'https://proyecto.supabase.co/storage/v1/object/sign/...',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Archivo ausente, formato no permitido o contenido que no coincide',
    schema: {
      example: {
        statusCode: 400,
        message: 'Formato no permitido. Usa JPG, PNG o WebP',
        error: 'Bad Request',
      },
    },
  })
  @ApiPayloadTooLargeResponse({ description: 'La imagen supera los 2 MB' })
  @ApiForbiddenResponse({ description: 'La pregunta pertenece a otro usuario' })
  @ApiNotFoundResponse({ description: 'La pregunta no existe' })
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.images.replace(user, id, file);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina la imagen de una pregunta del almacenamiento' })
  @ApiNoContentResponse({ description: 'Imagen eliminada' })
  @ApiNotFoundResponse({ description: 'La pregunta no existe o no tiene imagen' })
  @ApiForbiddenResponse({ description: 'La pregunta pertenece a otro usuario' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.images.remove(user, id);
  }
}
