import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { ChatLimitsService } from './chat-limits.service';
import { ChatOrchestrator } from './chat-orchestrator.service';
import { DeepSeekClient } from './providers/deepseek.client';
import { QuizChatController } from './quiz-chat.controller';
import { QuizChatService } from './quiz-chat.service';
import { QuizToolsExecutor } from './tools/quiz-tools.executor';

@Module({
  imports: [QuizzesModule, ProfilesModule],
  controllers: [QuizChatController],
  providers: [
    QuizChatService,
    DeepSeekClient,
    ChatOrchestrator,
    QuizToolsExecutor,
    ChatLimitsService,
  ],
})
export class ChatbotModule {}
