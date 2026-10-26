import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Profile } from '../profiles/profile.entity';
import { Quiz } from '../quizzes/quiz.entity';

export const SESSION_STATUSES = ['WAITING', 'IN_PROGRESS', 'FINISHED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

@Entity('game_sessions')
@Check(`"status" IN ('WAITING', 'IN_PROGRESS', 'FINISHED')`)
export class GameSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 8 })
  code: string;

  @Column('uuid', { nullable: true })
  quizId: string | null;

  @ManyToOne(() => Quiz, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'quizId' })
  quiz: Quiz | null;

  @Index()
  @Column('uuid')
  hostId: string;

  @ManyToOne(() => Profile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'hostId' })
  host: Profile;

  @Column({ type: 'varchar', length: 120 })
  quizTitle: string;

  @Column({ type: 'varchar', length: 20, default: 'WAITING' })
  status: SessionStatus;

  @Column({ type: 'int', default: -1 })
  currentIndex: number;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
