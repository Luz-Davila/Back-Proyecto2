import {
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { QuestionBatchesController } from '../quizzes/question-batches.controller';
import { QuestionBatchesService } from '../quizzes/question-batches.service';
import { QuizChatController } from './quiz-chat.controller';
import { QuizChatService } from './quiz-chat.service';

describe('Contrato HTTP y guard real del chatbot/lote', () => {
  let app: INestApplication<Server>;
  const quiz = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const respond = jest
    .fn()
    .mockResolvedValue({ reply: '¿Qué tema?', draft: null });
  const create = jest
    .fn()
    .mockResolvedValue({ operationId: quiz, questions: [] });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [QuizChatController, QuestionBatchesController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: AuthService,
          useValue: {
            verifyAccessToken: (token: string) => {
              if (token !== 'test-token') throw new UnauthorizedException();
              return Promise.resolve({ id: 'teacher' });
            },
          },
        },
        { provide: QuizChatService, useValue: { respond } },
        { provide: QuestionBatchesService, useValue: { create } },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(['chat', 'questions/batch'])('protege %s con JWT', async (route) => {
    await request(app.getHttpServer())
      .post(`/quizzes/${quiz}/${route}`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post(`/quizzes/${quiz}/${route}`)
      .set('Authorization', 'Bearer invalid')
      .send({})
      .expect(401);
  });

  it('valida historial y devuelve 200, no 201', async () => {
    await request(app.getHttpServer())
      .post(`/quizzes/${quiz}/chat`)
      .set('Authorization', 'Bearer test-token')
      .send({ messages: [{ role: 'system', content: 'no permitido' }] })
      .expect(400);
    const result = await request(app.getHttpServer())
      .post(`/quizzes/${quiz}/chat`)
      .set('Authorization', 'Bearer test-token')
      .send({ messages: [{ role: 'user', content: 'Hola' }] })
      .expect(200);
    expect(result.body as unknown).toEqual({
      reply: '¿Qué tema?',
      draft: null,
    });
  });

  it('valida booleanos de lote sin coerción y no cambia la ruta de pregunta individual', async () => {
    await request(app.getHttpServer())
      .post(`/quizzes/${quiz}/questions/batch`)
      .set('Authorization', 'Bearer test-token')
      .send({
        operationId: quiz,
        questions: [{ statement: 'Pregunta', correctBoolean: 'true' }],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/quizzes/${quiz}/questions/batch`)
      .set('Authorization', 'Bearer test-token')
      .send({
        operationId: quiz,
        questions: [{ statement: 'Pregunta', correctBoolean: true }],
      })
      .expect(200);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
