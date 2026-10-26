import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Profile } from '../profiles/profile.entity';
import { Question } from './question.entity';

@Entity('quizzes')
export class Quiz {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  ownerId: string;

  @ManyToOne(() => Profile, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'ownerId' })
  owner: Profile;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @OneToMany(() => Question, (question) => question.quiz)
  questions: Question[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
