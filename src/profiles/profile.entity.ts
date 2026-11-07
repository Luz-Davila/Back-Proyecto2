import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { UserRole } from './user-role';

@Entity('profiles')
export class Profile {
  @PrimaryColumn('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  displayName: string;

  @Column({ type: 'varchar', length: 20, default: 'student' })
  role: UserRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
