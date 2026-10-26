import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesModule } from '../profiles/profiles.module';
import { Question } from './question.entity';
import { QuestionsController, QuizQuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { Quiz } from './quiz.entity';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Quiz, Question]), ProfilesModule],
  controllers: [QuizzesController, QuizQuestionsController, QuestionsController],
  providers: [QuizzesService, QuestionsService],
})
export class QuizzesModule {}
