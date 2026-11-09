import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { QuestionKind } from '../quizzes/question-kind';
import { Question } from '../quizzes/question.entity';
import { GameSession } from './game-session.entity';

export const SESSION_QUESTION_STATUSES = ['PENDING', 'OPEN', 'CLOSED'] as const;
export type SessionQuestionStatus = (typeof SESSION_QUESTION_STATUSES)[number];

@Entity('session_questions')
@Unique(['sessionId', 'position'])
@Check(`"status" IN ('PENDING', 'OPEN', 'CLOSED')`)
@Check(`"durationSeconds" IS NULL OR ("durationSeconds" BETWEEN 5 AND 120)`)
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

  @Column({ type: 'varchar', length: 20, default: 'boolean' })
  kind: QuestionKind;

  @Column({ type: 'boolean' })
  correctBoolean: boolean;

  @Column({ type: 'jsonb', nullable: true })
  options: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  correctIndexes: number[] | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  imageKey: string | null;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: SessionQuestionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewEndsAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  scoredAt: Date | null;
}
