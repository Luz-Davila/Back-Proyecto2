import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { GameSession } from './game-session.entity';
import { SessionParticipant } from './session-participant.entity';

@Entity('game_results')
@Unique(['sessionId', 'participantId'])
export class GameResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: GameSession;

  @Column('uuid')
  participantId: string;

  @ManyToOne(() => SessionParticipant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participantId' })
  participant: SessionParticipant;

  @Column({ type: 'int' })
  totalScore: number;

  @Column({ type: 'int' })
  rank: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
