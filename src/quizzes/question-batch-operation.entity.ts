import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Quiz } from './quiz.entity';

export interface BatchQuestionReceipt {
  id: string;
  quizId: string;
  statement: string;
  correctBoolean: boolean;
  position: number;
  imageKey: null;
  imageUrl: null;
}
export interface QuestionBatchReceipt {
  operationId: string;
  questions: BatchQuestionReceipt[];
}

@Entity('question_batch_operations')
export class QuestionBatchOperation {
  @PrimaryColumn('uuid')
  userId: string;

  @PrimaryColumn('uuid')
  quizId: string;

  @PrimaryColumn('uuid')
  operationId: string;

  @ManyToOne(() => Quiz, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quizId' })
  quiz: Quiz;

  @Column({ type: 'varchar', length: 64 })
  payloadHash: string;

  @Column('jsonb')
  receipt: QuestionBatchReceipt;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
