import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesModule } from '../profiles/profiles.module';
import { StorageModule } from '../storage/storage.module';
import { Question } from './question.entity';
import { QuestionImagesController } from './question-images.controller';
import { QuestionImagesService } from './question-images.service';
import { QuestionsController, QuizQuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { Quiz } from './quiz.entity';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';

@Module({
  imports: [TypeOrmModule.forFeature([Quiz, Question]), ProfilesModule, StorageModule],
  controllers: [
    QuizzesController,
    QuizQuestionsController,
    QuestionsController,
    QuestionImagesController,
  ],
  providers: [QuizzesService, QuestionsService, QuestionImagesService],
})
export class QuizzesModule {}
