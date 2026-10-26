import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Question } from '../quizzes/question.entity';
import { GameSession } from './game-session.entity';

export const SESSION_QUESTION_STATUSES = ['PENDING', 'OPEN', 'CLOSED'] as const;
export type SessionQuestionStatus = (typeof SESSION_QUESTION_STATUSES)[number];

@Entity('session_questions')
@Unique(['sessionId', 'position'])
@Check(`"status" IN ('PENDING', 'OPEN', 'CLOSED')`)
export class SessionQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: GameSession;

  @Column('uuid', { nullable: true })
  originalQuestionId: string | null;

  @ManyToOne(() => Question, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'originalQuestionId' })
  originalQuestion: Question | null;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', length: 500 })
  statement: string;

  @Column({ type: 'boolean' })
  correctBoolean: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  imageKey: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: SessionQuestionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt: Date | null;
}
