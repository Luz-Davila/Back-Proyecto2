import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Quiz } from './quiz.entity';
import type { QuestionKind } from './question-kind';

@Entity('questions')
@Unique(['quizId', 'position'])
@Check(`"durationSeconds" IS NULL OR ("durationSeconds" BETWEEN 5 AND 120)`)
export class Question {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  quizId: string;

  @ManyToOne(() => Quiz, (quiz) => quiz.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quizId' })
  quiz: Quiz;

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

  /** Si es null, la sala usa su tiempo por defecto. */
  @Column({ type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ type: 'int' })
  position: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
