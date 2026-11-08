import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.service';
import { Quiz } from './quiz.entity';

/** Misma fila y orden de bloqueo en CRUD y lotes. Solo dentro de una transacción. */
export async function lockQuizForWrite(
  manager: EntityManager,
  user: AuthenticatedUser,
  quizId: string,
  hideForeign = false,
) {
  const quiz = await manager.findOne(Quiz, {
    where: { id: quizId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!quiz || (hideForeign && quiz.ownerId !== user.id))
    throw new NotFoundException('Cuestionario no encontrado');
  if (quiz.ownerId !== user.id)
    throw new ForbiddenException(
      'No puedes modificar preguntas de otro usuario',
    );
  return quiz;
}
