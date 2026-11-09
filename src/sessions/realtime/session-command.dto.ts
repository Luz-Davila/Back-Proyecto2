import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SESSION_CODE_PATTERN } from '../session-code.generator';

export class SessionIdCommandDto {
  @IsUUID()
  sessionId: string;
}
export class AdvanceCommandDto extends SessionIdCommandDto {
  @IsUUID()
  expectedQuestionId: string;
}
export class JoinCommandDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(SESSION_CODE_PATTERN)
  code: string;
}
export class RefreshCommandDto {
  @IsString()
  @MinLength(1)
  token: string;
}

export class SubmitAnswerCommandDto {
  @IsUUID()
  sessionQuestionId: string;

  @ValidateIf((dto: SubmitAnswerCommandDto) => dto.choiceIndex === undefined)
  @IsBoolean()
  choice?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  choiceIndex?: number;
}
