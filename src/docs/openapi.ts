import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('ProfeLink · API de actividades')
    .setDescription(
      'API REST para perfiles, cuestionarios, preguntas, imágenes y resultados de las ' +
        'evaluaciones en vivo de ProfeLink.\n\n' +
        'Todas las rutas salvo `/health` y `/` requieren un token de Supabase Auth en el ' +
        'encabezado `Authorization: Bearer <token>`.\n\n' +
        'Los errores usan el formato estándar de NestJS: ' +
        '`{ "statusCode": 403, "message": "...", "error": "Forbidden" }`.',
    )
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Token emitido por Supabase Auth',
    })
    .addTag('Perfiles', 'Perfil del usuario autenticado')
    .addTag('Cuestionarios', 'CRUD de cuestionarios del creador')
    .addTag('Preguntas', 'Preguntas de verdadero o falso')
    .addTag('Imágenes', 'Imagen opcional de cada pregunta')
    .addTag('Salud', 'Estado del servicio')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  app.use(
    '/docs',
    apiReference({
      spec: { content: document },
      pageTitle: 'ProfeLink API',
    }),
  );
  app.getHttpAdapter().get('/openapi.json', (_request, response) => {
    response.json(document);
  });
}
