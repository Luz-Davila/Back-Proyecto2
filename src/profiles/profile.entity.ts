import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DEFAULT_OWL_AVATAR_ID, type OwlAvatarId } from './owl-avatar';
import type { UserRole } from './user-role';

@Entity('profiles')
export class Profile {
  @PrimaryColumn('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  displayName: string;

  @Column({ type: 'varchar', length: 20, default: DEFAULT_OWL_AVATAR_ID })
  avatarId: OwlAvatarId;

  @Column({ type: 'varchar', length: 20, default: 'student' })
  role: UserRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
