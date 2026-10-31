import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { SessionParticipant } from './session-participant.entity';

/** Reserva activa: el historial permanece en session_participants al finalizar. */
@Entity('active_session_memberships')
@Index('IDX_active_session_memberships_session', ['sessionId'])
export class ActiveSessionMembership {
  @PrimaryColumn('uuid', {
    primaryKeyConstraintName: 'PK_active_session_memberships',
  })
  userId: string;

  @Column('uuid')
  sessionId: string;

  @ManyToOne(() => SessionParticipant, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn([
    {
      name: 'sessionId',
      referencedColumnName: 'sessionId',
      foreignKeyConstraintName: 'FK_active_session_memberships_participant',
    },
    {
      name: 'userId',
      referencedColumnName: 'userId',
      foreignKeyConstraintName: 'FK_active_session_memberships_participant',
    },
  ])
  participant: SessionParticipant;
}
