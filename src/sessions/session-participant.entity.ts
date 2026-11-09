import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { DEFAULT_OWL_AVATAR_ID, type OwlAvatarId } from '../profiles/owl-avatar';
import { Profile } from '../profiles/profile.entity';
import { GameSession } from './game-session.entity';

@Entity('session_participants')
@Unique(['sessionId', 'userId'])
export class SessionParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionId: string;

  @ManyToOne(() => GameSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: GameSession;

  @Index()
  @Column('uuid')
  userId: string;

  @ManyToOne(() => Profile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user: Profile;

  @Column({ type: 'varchar', length: 40 })
  displayName: string;

  @Column({ type: 'varchar', length: 20, default: DEFAULT_OWL_AVATAR_ID })
  avatarId: OwlAvatarId;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
