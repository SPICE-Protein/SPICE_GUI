import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiRequestError,
  deriveModelsUrl,
  listModels,
  requestChat,
  requestChatWithRetry,
  streamChat,
  streamChatCompletion,
  testConnection,
  type AiChatMessage,
} from '$lib/ai/client';

const CONFIG = {
  endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
  model: 'qwen3:8b',
  apiKey: 'sk-test',
  temperature: 0.3,
  maxTokens: 512,
};

const MESSAGES: AiChatMessage[] = [
  { role: 'system', content: 'You are a cloning assistant.' },
  { role: 'user', content: 'Optimize this gene.' },
  { role: 'assistant', content: 'Sure, send the sequence.' },
];

function jsonResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('requestChat', () => {
  it('posts the full history with auth and generation settings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse('Done.'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChat(CONFIG, MESSAGES)).resolves.toBe('Done.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CONFIG.endpoint);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });
    expect(JSON.parse(init.body)).toEqual({
      model: CONFIG.model,
      messages: MESSAGES,
      temperature: 0.3,
      stream: false,
      max_tokens: 512,
    });
  });

  it('omits Authorization and max_tokens when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);

    await requestChat({ endpoint: CONFIG.endpoint, model: CONFIG.model }, MESSAGES);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body).max_tokens).toBeUndefined();
  });

  it('rejects an empty endpoint before making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChat({ endpoint: '  ', model: 'x' }, MESSAGES))
      .rejects.toMatchObject({ kind: 'http' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [500, 'server'],
    [502, 'server'],
    [400, 'http'],
  ])('classifies HTTP %i as %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status })));

    await expect(requestChat(CONFIG, MESSAGES)).rejects.toMatchObject({
      name: 'AiRequestError',
      kind,
      status,
    });
  });

  it('classifies non-JSON and empty completions as parse errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    await expect(requestChat(CONFIG, MESSAGES)).rejects.toMatchObject({ kind: 'parse' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('   ')));
    await expect(requestChat(CONFIG, MESSAGES)).rejects.toMatchObject({ kind: 'parse' });
  });

  it('classifies transport failures as network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await requestChat(CONFIG, MESSAGES).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AiRequestError);
    expect(error).toMatchObject({ kind: 'network' });
  });

  it('aborts after the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );

    await expect(requestChat(CONFIG, MESSAGES, { timeoutMs: 20 }))
      .rejects.toMatchObject({ kind: 'timeout' });
  });

  it('surfaces external cancellation as a network error', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );

    const promise = requestChat(CONFIG, MESSAGES, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'network' });
  });
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('streamChat', () => {
  it('reassembles SSE events split across chunk boundaries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      '\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const tokens: string[] = [];

    const result = await streamChat(CONFIG, MESSAGES, {
      onToken: (delta) => tokens.push(delta),
    });

    expect(result).toBe('Hello!');
    expect(tokens).toEqual(['Hel', 'lo', '!']);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });

  it('accepts a non-streaming JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Whole answer')));
    const tokens: string[] = [];

    await expect(streamChat(CONFIG, MESSAGES, { onToken: (delta) => tokens.push(delta) }))
      .resolves.toBe('Whole answer');
    expect(tokens).toEqual(['Whole answer']);
  });

  it('parses newline-delimited JSON', async () => {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"choices":[{"delta":{"content":"A"}}]}\n'));
        controller.enqueue(encoder.encode('{"choices":[{"delta":{"content":"B"}}]}\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })));

    await expect(streamChat(CONFIG, MESSAGES)).resolves.toBe('AB');
  });

  it('classifies an SSE error payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'data: {"error":{"message":"model not found"}}\n\n',
    ])));

    await expect(streamChat(CONFIG, MESSAGES)).rejects.toMatchObject({
      kind: 'server',
      message: expect.stringContaining('model not found'),
    });
  });

  it('rejects an empty stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['data: [DONE]\n\n'])));
    await expect(streamChat(CONFIG, MESSAGES)).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('streamChatCompletion tool calls', () => {
  it('assembles function names and argument fragments across chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_","arguments":"{\\"query\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"workspace","arguments":":\\"BL21\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await streamChatCompletion(CONFIG, MESSAGES, {
      tools: [{
        type: 'function',
        function: { name: 'get_workspace', description: 'Read state', parameters: { type: 'object', properties: {} } },
      }],
    });

    expect(result.content).toBe('');
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([{
      id: 'call_1',
      type: 'function',
      function: { name: 'get_workspace', arguments: '{"query":"BL21"}' },
    }]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools[0].function.name).toBe('get_workspace');
  });

  it('reads complete tool_calls from a non-streaming JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_2',
            type: 'function',
            function: { name: 'analyze_dna', arguments: '{"circular":true}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    }), { status: 200 })));

    const result = await streamChatCompletion(CONFIG, MESSAGES);
    expect(result.toolCalls[0]).toMatchObject({
      id: 'call_2',
      function: { name: 'analyze_dna', arguments: '{"circular":true}' },
    });
  });

  it('does not treat a tool-only reply as empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'x', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
      }],
    }), { status: 200 })));

    await expect(streamChatCompletion(CONFIG, MESSAGES)).resolves.toMatchObject({
      content: '',
      toolCalls: [{ id: 'x' }],
    });
  });
});

describe('listModels and connection test', () => {
  it('derives the sibling models URL', () => {
    expect(deriveModelsUrl('http://localhost:11434/v1/chat/completions'))
      .toBe('http://localhost:11434/v1/models');
    expect(deriveModelsUrl('https://api.example.test/v1'))
      .toBe('https://api.example.test/v1/models');
  });

  it('lists and deduplicates model ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'qwen3:8b' }, { id: 'llama3.3' }, { id: 'qwen3:8b' }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listModels(CONFIG)).resolves.toEqual(['qwen3:8b', 'llama3.3']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:11434/v1/models');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
  });

  it('falls back to a one-token chat when /models is unavailable', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(jsonResponse('pong'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(testConnection(CONFIG)).resolves.toEqual({ ok: true, models: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports authentication failures without falling back', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await testConnection(CONFIG);
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('auth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('requestChatWithRetry', () => {
  it('retries transient transport failures', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse('recovered'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChatWithRetry(CONFIG, MESSAGES, { retries: 1, baseDelayMs: 0 }))
      .resolves.toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestChatWithRetry(CONFIG, MESSAGES, { retries: 3, baseDelayMs: 0 }))
      .rejects.toMatchObject({ kind: 'auth' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
