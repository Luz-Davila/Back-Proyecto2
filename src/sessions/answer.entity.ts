import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SessionParticipant } from './session-participant.entity';
import { SessionQuestion } from './session-question.entity';

@Entity('answers')
@Unique(['sessionQuestionId', 'participantId'])
export class Answer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionQuestionId: string;

  @ManyToOne(() => SessionQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionQuestionId' })
  sessionQuestion: SessionQuestion;

  @Column('uuid')
  participantId: string;

  @ManyToOne(() => SessionParticipant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participantId' })
  participant: SessionParticipant;

  @Column({ type: 'boolean' })
  choice: boolean;

  @Column({ type: 'timestamptz' })
  answeredAt: Date;

  @Column({ type: 'int', default: 0 })
  score: number;
}
