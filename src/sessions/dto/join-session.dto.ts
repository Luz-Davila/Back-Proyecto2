import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { SESSION_CODE_PATTERN } from '../session-code.generator';

export class JoinSessionDto {
  @ApiProperty({
    example: 'ABC234',
    pattern: SESSION_CODE_PATTERN.source,
    minLength: 6,
    maxLength: 6,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(SESSION_CODE_PATTERN)
  code: string;
}
