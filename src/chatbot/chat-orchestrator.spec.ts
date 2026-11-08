import { ConfigService } from '@nestjs/config';
import { ChatOrchestrator } from './chat-orchestrator.service';
import { DeepSeekClient } from './providers/deepseek.client';
import { QuizToolsExecutor } from './tools/quiz-tools.executor';
import { ChatLimitsService } from './chat-limits.service';

const context = {
  title: 'Prueba',
  description: null,
  questionsCount: 0,
  truncated: false,
  questions: [],
};
const request = {
  messages: [{ role: 'user' as const, content: 'Una afirmación sobre el Sol' }],
  requestedCount: 1,
};
const toolReply = {
  role: 'assistant',
  content: null,
  tool_calls: [
    {
      id: 'call-1',
      type: 'function',
      function: {
        name: 'proposeQuestions',
        arguments: JSON.stringify({
          questions: [
            { statement: 'El Sol es una estrella', correctBoolean: true },
          ],
        }),
      },
    },
  ],
};

describe('Orquestación y límites', () => {
  it('envía el resultado con tool_call_id y entrega el borrador solo al finalizar', async () => {
    const complete = jest
      .fn()
      .mockResolvedValueOnce(toolReply)
      .mockResolvedValueOnce({
        role: 'assistant',
        content: 'Propuesta lista para revisar.',
      });
    const result = await new ChatOrchestrator(
      { complete } as unknown as DeepSeekClient,
      new QuizToolsExecutor(),
    ).respond(request, context, AbortSignal.timeout(5000));
    expect(result.draft?.questions).toHaveLength(1);
    expect(complete.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'call-1' }),
      ]),
    );
  });

  it('aclara sin propuesta y preserva el contexto de borrador corregido', async () => {
    const complete = jest.fn().mockResolvedValue({
      role: 'assistant',
      content: '¿Qué tema necesitas?',
    });
    const result = await new ChatOrchestrator(
      { complete } as unknown as DeepSeekClient,
      new QuizToolsExecutor(),
    ).respond(
      {
        ...request,
        currentDraft: {
          questions: [{ statement: 'Edición humana', correctBoolean: false }],
        },
      },
      context,
      AbortSignal.timeout(5000),
    );
    expect(result.draft).toBeNull();
    expect(complete.mock.calls[0][0][1].content).toContain('Edición humana');
  });

  it('envía el borrador corregido sin imponer el total anterior y recibe la ampliación completa', async () => {
    const retained = [
      {
        statement: 'Costa Rica está en América Central.',
        correctBoolean: true,
      },
    ];
    const expanded = [
      ...retained,
      { statement: 'Francia está en Asia.', correctBoolean: false },
      { statement: 'Japón está en Asia.', correctBoolean: true },
    ];
    const complete = jest
      .fn()
      .mockResolvedValueOnce({
        ...toolReply,
        tool_calls: [
          {
            ...toolReply.tool_calls[0],
            function: {
              name: 'proposeQuestions',
              arguments: JSON.stringify({ questions: expanded }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        role: 'assistant',
        content: 'Añadí dos países al borrador; revisa las tres preguntas.',
      });
    const result = await new ChatOrchestrator(
      { complete } as unknown as DeepSeekClient,
      new QuizToolsExecutor(),
    ).respond(
      {
        messages: [{ role: 'user', content: 'Agrega 2 países más' }],
        currentDraft: { questions: retained },
      },
      context,
      AbortSignal.timeout(5000),
    );
    expect(result.draft?.questions).toEqual(expanded);
    const sent = complete.mock.calls[0][0];
    expect(JSON.parse(sent[1].content.split('\n')[1])).toMatchObject({
      requestedCount: null,
      currentDraft: { questions: retained },
    });
    expect(sent[0].content).toContain('N es un incremento');
    expect(complete.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: JSON.stringify({ prepared: 3, saved: false }),
        }),
      ]),
    );
  });

  it('corta el bucle y nunca confirma el borrador si falla la respuesta final', async () => {
    const complete = jest.fn().mockResolvedValue(toolReply);
    const orchestrator = new ChatOrchestrator(
      { complete } as unknown as DeepSeekClient,
      new QuizToolsExecutor(),
    );
    await expect(
      orchestrator.respond(request, context, AbortSignal.timeout(5000)),
    ).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(6);
    complete
      .mockReset()
      .mockResolvedValueOnce(toolReply)
      .mockResolvedValueOnce({ role: 'assistant', content: '' });
    await expect(
      orchestrator.respond(request, context, AbortSignal.timeout(5000)),
    ).rejects.toThrow();
  });

  it('libera la concurrencia y aplica cinco turnos por minuto de forma aislada', () => {
    const limits = new ChatLimitsService();
    const release = limits.acquire('a');
    expect(() => limits.acquire('a')).toThrow();
    limits.acquire('b')();
    release();
    for (let i = 0; i < 4; i++) limits.acquire('a')();
    expect(() => limits.acquire('a')).toThrow();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    expect(() => limits.acquire('a')()).not.toThrow();
    jest.restoreAllMocks();
  });
});

describe('Cliente DeepSeek (sin red)', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('configuración opcional y errores que no revelan credenciales', async () => {
    const client = new DeepSeekClient(new ConfigService({}));
    expect(() => client.assertConfigured()).toThrow(
      'El asistente no está configurado',
    );
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('no revelar secreto-test'));
    await expect(
      new DeepSeekClient(
        new ConfigService({ DEEPSEEK_API_KEY: 'secreto-test' }),
      ).complete([], AbortSignal.timeout(5000)),
    ).rejects.toThrow('No se pudo completar');
  });

  it('filtra la respuesta del proveedor y envía configuración non-thinking', async () => {
    const mock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'Hola', reasoning_content: 'privado' },
              finish_reason: 'stop',
            },
          ],
        }),
      ),
    );
    global.fetch = mock;
    const reply = await new DeepSeekClient(
      new ConfigService({ DEEPSEEK_API_KEY: 'test-only' }),
    ).complete([], AbortSignal.timeout(5000));
    expect(reply).toEqual({ role: 'assistant', content: 'Hola' });
    expect(JSON.parse(mock.mock.calls[0][1].body).thinking).toEqual({
      type: 'disabled',
    });
    expect(JSON.parse(mock.mock.calls[0][1].body).model).toBe('deepseek-flash');
  });

  it.each([
    new Response('externo privado', { status: 429 }),
    new Response('{}'),
    new Response('no JSON'),
  ])(
    'rechaza fallo o formato inválido sin filtrar cuerpo',
    async (response) => {
      global.fetch = jest.fn().mockResolvedValue(response);
      await expect(
        new DeepSeekClient(
          new ConfigService({ DEEPSEEK_API_KEY: 'test' }),
        ).complete([], AbortSignal.timeout(5000)),
      ).rejects.toThrow('No se pudo completar');
    },
  );

  it('traduce cancelación a timeout', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('abort'));
    await expect(
      new DeepSeekClient(
        new ConfigService({ DEEPSEEK_API_KEY: 'test' }),
      ).complete([], AbortSignal.abort()),
    ).rejects.toThrow('tardó demasiado');
  });
});
