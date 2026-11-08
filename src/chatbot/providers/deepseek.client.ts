import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chatError, providerError, timeoutError } from '../chat.errors';
import type { ModelMessage, ToolCall } from '../contracts/chat.contracts';
import { QUIZ_TOOLS } from '../tools/quiz-tools.catalog';

@Injectable()
export class DeepSeekClient {
  constructor(private readonly config: ConfigService) {}

  assertConfigured(): void {
    if (!this.config.get<string>('DEEPSEEK_API_KEY')?.trim()) {
      throw chatError(
        503,
        'CHAT_NOT_CONFIGURED',
        'El asistente no está configurado. Puedes seguir agregando preguntas manualmente.',
      );
    }
  }

  async complete(
    messages: ModelMessage[],
    signal: AbortSignal,
  ): Promise<ModelMessage> {
    this.assertConfigured();
    const configured = Number(this.config.get('DEEPSEEK_TIMEOUT_MS') ?? 60_000);
    const timeout =
      Number.isFinite(configured) && configured >= 1000
        ? Math.min(configured, 90_000)
        : 60_000;
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    try {
      const response = await fetch(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          signal: combined,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get<string>('DEEPSEEK_API_KEY')!.trim()}`,
          },
          body: JSON.stringify({
            model:
              this.config.get<string>('DEEPSEEK_MODEL')?.trim() ||
              'deepseek-flash',
            thinking: { type: 'disabled' },
            stream: false,
            max_tokens: 8192,
            messages,
            tools: QUIZ_TOOLS,
            tool_choice: 'auto',
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw providerError();
      }
      const body: unknown = await response.json();
      return this.parse(body);
    } catch {
      if (combined.aborted) throw timeoutError();
      throw providerError();
    }
  }

  private parse(value: unknown): ModelMessage {
    const body = value as {
      choices?: {
        finish_reason?: string;
        message?: { content?: unknown; tool_calls?: unknown };
      }[];
    };
    const choice = body?.choices?.[0];
    if (
      !choice ||
      choice.finish_reason === 'length' ||
      choice.finish_reason === 'content_filter'
    )
      throw providerError();
    const message = choice.message;
    if (
      !message ||
      (message.content != null && typeof message.content !== 'string')
    )
      throw providerError();
    const calls = message.tool_calls;
    if (calls !== undefined && (!Array.isArray(calls) || calls.length > 20))
      throw providerError();
    const parsed: ToolCall[] = [];
    for (const entry of (calls ?? []) as unknown[]) {
      const call = entry as ToolCall;
      if (
        !call ||
        typeof call.id !== 'string' ||
        call.id.length > 200 ||
        call.type !== 'function' ||
        typeof call.function?.name !== 'string' ||
        typeof call.function.arguments !== 'string'
      )
        throw providerError();
      if (parsed.some((item) => item.id === call.id)) throw providerError();
      parsed.push({
        id: call.id,
        type: 'function',
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      });
    }
    return {
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : null,
      ...(parsed.length ? { tool_calls: parsed } : {}),
    };
  }
}
