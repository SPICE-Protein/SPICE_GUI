// OpenAI-compatible chat transport for the Co-Pilot.
//
// This is intentionally provider-agnostic: Ollama, LM Studio, and hosted
// OpenAI-compatible services all speak /v1/chat/completions. Requests carry the
// full message history and an optional bearer token; failures are classified so
// the UI can distinguish bad credentials from a missing local server.

export type AiErrorKind = 'auth' | 'rate-limit' | 'server' | 'network' | 'timeout' | 'http' | 'parse';

export class AiRequestError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(kind: AiErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'AiRequestError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface AiChatConfig {
  endpoint: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant messages that request tool execution. */
  tool_calls?: AiToolCall[];
  /** Present on tool-result messages. */
  tool_call_id?: string;
  name?: string;
}

export interface AiChatOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AiStreamOptions extends AiChatOptions {
  /** Called for every text delta together with the accumulated response. */
  onToken?: (delta: string, full: string) => void;
  /** OpenAI-style function definitions made available to the model. */
  tools?: AiToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface AiStreamResult {
  content: string;
  toolCalls: AiToolCall[];
  finishReason: string | null;
}

export interface AiRetryOptions extends AiChatOptions {
  retries?: number;
  baseDelayMs?: number;
}

export interface AiConnectionResult {
  ok: boolean;
  models: string[];
  error?: AiRequestError;
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface RequestContext {
  controller: AbortController;
  arm: () => void;
  cleanup: () => void;
  externallyAborted: () => boolean;
}

function createRequestContext(timeoutMs: number, signal?: AbortSignal): RequestContext {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  arm();
  return {
    controller,
    arm,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
    externallyAborted: () => signal?.aborted === true,
  };
}

function abortError(context: RequestContext, timeoutMs: number): AiRequestError {
  if (context.externallyAborted()) {
    return new AiRequestError('network', 'request cancelled');
  }
  return new AiRequestError('timeout', `request timed out after ${timeoutMs} ms`);
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  return undefined;
}

async function responseError(response: Response): Promise<AiRequestError> {
  const text = await response.text().catch(() => '');
  const detail = text.slice(0, 240) || response.statusText;
  if (response.status === 401 || response.status === 403) {
    return new AiRequestError('auth', `authentication failed (${response.status}): ${detail}`, response.status);
  }
  if (response.status === 429) {
    return new AiRequestError('rate-limit', `rate limited (429): ${detail}`, 429, retryAfterMs(response));
  }
  if (response.status >= 500) {
    return new AiRequestError('server', `server error (${response.status}): ${detail}`, response.status);
  }
  return new AiRequestError('http', `request failed (${response.status}): ${detail}`, response.status);
}

function requestBody(config: AiChatConfig, messages: AiChatMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature ?? 0.7,
    stream,
  };
  if (config.maxTokens && config.maxTokens > 0) body.max_tokens = config.maxTokens;
  return body;
}

function requestHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function postChat(
  config: AiChatConfig,
  messages: AiChatMessage[],
  options: AiChatOptions,
  stream: boolean,
  extras: Record<string, unknown> = {},
): Promise<{ response: Response; context: RequestContext; timeoutMs: number }> {
  const endpoint = config.endpoint?.trim();
  if (!endpoint) throw new AiRequestError('http', 'AI endpoint is empty');

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const context = createRequestContext(timeoutMs, options.signal);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: requestHeaders(config.apiKey),
      body: JSON.stringify({ ...requestBody(config, messages, stream), ...extras }),
      signal: context.controller.signal,
    });
  } catch (error) {
    context.cleanup();
    if (context.controller.signal.aborted) throw abortError(context, timeoutMs);
    throw new AiRequestError('network', error instanceof Error ? error.message : String(error));
  }

  if (!response.ok) {
    context.cleanup();
    throw await responseError(response);
  }

  // Timeout measures inactivity rather than total wall-clock time. Streaming
  // callers re-arm this after each received chunk.
  context.arm();
  return { response, context, timeoutMs };
}

function completionContent(payload: unknown): string {
  const choice = (payload as {
    choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown }>;
  })?.choices?.[0];
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  return typeof content === 'string' ? content : '';
}

function parseToolCalls(raw: unknown): AiToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: AiToolCall[] = [];
  for (const entry of raw) {
    const record = entry as {
      id?: unknown;
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const name = typeof record?.function?.name === 'string' ? record.function.name : '';
    const args = record?.function?.arguments;
    const serialized = typeof args === 'string' ? args : JSON.stringify(args ?? {});
    if (!name) continue;
    out.push({
      id: typeof record.id === 'string' && record.id ? record.id : `call_${out.length}`,
      type: 'function',
      function: { name, arguments: serialized },
    });
  }
  return out;
}

function completionResult(payload: unknown): AiStreamResult {
  const choice = (payload as {
    choices?: Array<{
      message?: { tool_calls?: unknown };
      delta?: { tool_calls?: unknown };
      finish_reason?: unknown;
    }>;
  })?.choices?.[0];
  return {
    content: completionContent(payload),
    toolCalls: parseToolCalls(choice?.message?.tool_calls ?? choice?.delta?.tool_calls),
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function nativeError(error: unknown): AiRequestError {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  const status = Number(/HTTP\s+(\d{3})/i.exec(text)?.[1]);
  if (status === 401 || status === 403) return new AiRequestError('auth', text, status);
  if (status === 429) return new AiRequestError('rate-limit', text, status);
  if (status >= 500) return new AiRequestError('server', text, status);
  if (/timed?\s*out|timeout/i.test(text)) return new AiRequestError('timeout', text);
  return new AiRequestError('network', text);
}

/** CORS-free fallback: the Tauri origin is not allowed by most local model
 *  servers, so retry a failed direct request through the Rust transport. */
async function nativeCompletion(
  config: AiChatConfig,
  messages: AiChatMessage[],
  extras: Record<string, unknown> = {},
): Promise<AiStreamResult> {
  let payload: unknown;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    payload = await invoke<unknown>('ai_chat_native', {
      request: {
        endpoint: config.endpoint.trim(),
        apiKey: config.apiKey?.trim() || null,
        body: { ...requestBody(config, messages, false), ...extras },
      },
    });
  } catch (error) {
    throw nativeError(error);
  }
  const result = completionResult(payload);
  if (!result.content.trim() && !result.toolCalls.length) {
    throw new AiRequestError('parse', 'AI endpoint returned an empty or malformed completion');
  }
  return result;
}

async function nativeChat(
  config: AiChatConfig,
  messages: AiChatMessage[],
  extras: Record<string, unknown> = {},
): Promise<string> {
  return (await nativeCompletion(config, messages, extras)).content;
}

async function nativeGet(url: string, apiKey?: string): Promise<unknown> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<unknown>('ai_get_native', {
      url,
      apiKey: apiKey?.trim() || null,
    });
  } catch (error) {
    throw nativeError(error);
  }
}

function parseModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown; models?: unknown })?.data
    ?? (payload as { models?: unknown })?.models;
  if (!Array.isArray(data)) {
    throw new AiRequestError('parse', 'models endpoint returned an unexpected shape');
  }
  const ids = data
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      return typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : '';
    })
    .filter(Boolean);
  return [...new Set(ids)];
}

/** POST one non-streaming chat completion and return the assistant text. */
export async function requestChat(
  config: AiChatConfig,
  messages: AiChatMessage[],
  options: AiChatOptions = {},
): Promise<string> {
  let post: Awaited<ReturnType<typeof postChat>>;
  try {
    post = await postChat(config, messages, options, false);
  } catch (error) {
    if (error instanceof AiRequestError
      && error.kind === 'network'
      && !options.signal?.aborted
      && isTauriRuntime()) {
      return nativeChat(config, messages);
    }
    throw error;
  }
  const { response, context } = post;
  try {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiRequestError('parse', 'AI endpoint returned non-JSON');
    }
    const content = completionContent(payload);
    if (!content.trim()) {
      throw new AiRequestError('parse', 'AI endpoint returned an empty or malformed completion');
    }
    return content;
  } catch (error) {
    if (context.controller.signal.aborted) {
      throw abortError(context, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    }
    throw error;
  } finally {
    context.cleanup();
  }
}

function toolExtras(options: Pick<AiStreamOptions, 'tools' | 'toolChoice'>): Record<string, unknown> {
  if (!options.tools?.length) return {};
  return {
    tools: options.tools,
    tool_choice: options.toolChoice ?? 'auto',
  };
}

/** Stream one chat completion via SSE (or NDJSON) and return both the text and
 *  any function calls the model requested. Some servers ignore `stream: true`
 *  and return a regular JSON body; that case is accepted as a single delta. */
export async function streamChatCompletion(
  config: AiChatConfig,
  messages: AiChatMessage[],
  options: AiStreamOptions = {},
): Promise<AiStreamResult> {
  const extras = toolExtras(options);
  let post: Awaited<ReturnType<typeof postChat>>;
  try {
    post = await postChat(config, messages, options, true, extras);
  } catch (error) {
    if (error instanceof AiRequestError
      && error.kind === 'network'
      && !options.signal?.aborted
      && isTauriRuntime()) {
      const result = await nativeCompletion(config, messages, extras);
      if (result.content) options.onToken?.(result.content, result.content);
      return result;
    }
    throw error;
  }
  const { response, context, timeoutMs } = post;
  let full = '';
  let finishReason: string | null = null;
  const toolCalls = new Map<number, AiToolCall>();

  const emit = (delta: string) => {
    if (!delta) return;
    full += delta;
    options.onToken?.(delta, full);
  };

  const mergeStreamingToolCalls = (raw: unknown) => {
    if (!Array.isArray(raw)) return;
    raw.forEach((entry, fallbackIndex) => {
      const record = entry as {
        index?: unknown;
        id?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      const index = typeof record?.index === 'number' ? record.index : fallbackIndex;
      let call = toolCalls.get(index);
      if (!call) {
        call = { id: '', type: 'function', function: { name: '', arguments: '' } };
        toolCalls.set(index, call);
      }
      if (typeof record.id === 'string' && record.id) call.id = record.id;
      const name = typeof record.function?.name === 'string' ? record.function.name : '';
      if (name && !call.function.name.endsWith(name)) call.function.name += name;
      const args = record.function?.arguments;
      if (typeof args === 'string') call.function.arguments += args;
    });
  };

  const mergeMessageToolCalls = (raw: unknown) => {
    const parsed = parseToolCalls(raw);
    if (!parsed.length) return;
    toolCalls.clear();
    parsed.forEach((call, index) => toolCalls.set(index, call));
  };

  const consumePayload = (payload: unknown): boolean => {
    const error = (payload as { error?: unknown })?.error;
    if (error) {
      const detail = typeof error === 'string'
        ? error
        : ((error as { message?: unknown })?.message ?? JSON.stringify(error));
      throw new AiRequestError('server', `AI stream error: ${String(detail)}`);
    }
    const choice = (payload as {
      choices?: Array<{
        message?: { content?: unknown; tool_calls?: unknown };
        delta?: { content?: unknown; tool_calls?: unknown };
        text?: unknown;
        finish_reason?: unknown;
      }>;
    })?.choices?.[0];
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
    if (typeof content === 'string') emit(content);
    if (Array.isArray(choice?.delta?.tool_calls)) mergeStreamingToolCalls(choice.delta.tool_calls);
    if (Array.isArray(choice?.message?.tool_calls)) mergeMessageToolCalls(choice.message.tool_calls);
    return true;
  };

  const consumeLine = (line: string): boolean => {
    const clean = line.replace(/\r$/, '');
    if (!clean.trim() || clean.startsWith(':')) return true;
    const data = clean.startsWith('data:') ? clean.slice(5).trim() : clean.trim();
    if (!data) return true;
    if (data === '[DONE]') return false;
    try {
      return consumePayload(JSON.parse(data));
    } catch (error) {
      if (error instanceof AiRequestError) throw error;
      // Providers may interleave keep-alive or non-JSON lines; ignore them.
      return true;
    }
  };

  const result = (): AiStreamResult => ({
    content: full,
    toolCalls: [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => ({
        ...call,
        id: call.id || `call_${index}`,
        function: { ...call.function, arguments: call.function.arguments || '{}' },
      }))
      .filter((call) => call.function.name),
    finishReason,
  });

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.body || (!contentType.includes('text/event-stream') && !contentType.includes('ndjson'))) {
      const text = await response.text();
      try {
        const payload = JSON.parse(text);
        consumePayload(payload);
      } catch (error) {
        if (error instanceof AiRequestError) throw error;
        // Fall through to line-based parsing for newline-delimited streams.
        for (const line of text.split('\n')) {
          if (!consumeLine(line)) break;
        }
      }
    } else {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        context.arm();
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!consumeLine(line)) {
            done = true;
            break;
          }
          newline = buffer.indexOf('\n');
        }
      }
      buffer += decoder.decode();
      if (!done && buffer.trim()) consumeLine(buffer);
      if (done) await reader.cancel().catch(() => undefined);
    }

    const output = result();
    if (!output.content.trim() && !output.toolCalls.length) {
      throw new AiRequestError('parse', 'AI endpoint returned an empty or malformed completion');
    }
    return output;
  } catch (error) {
    if (context.controller.signal.aborted) throw abortError(context, timeoutMs);
    const normalized = error instanceof AiRequestError
      ? error
      : new AiRequestError('network', error instanceof Error ? error.message : String(error));
    if (normalized.kind === 'network'
      && !full
      && !toolCalls.size
      && !options.signal?.aborted
      && isTauriRuntime()) {
      const native = await nativeCompletion(config, messages, extras);
      if (native.content) options.onToken?.(native.content, native.content);
      return native;
    }
    throw normalized;
  } finally {
    context.cleanup();
  }
}

/** Streaming convenience wrapper that returns only assistant text. */
export async function streamChat(
  config: AiChatConfig,
  messages: AiChatMessage[],
  options: AiStreamOptions = {},
): Promise<string> {
  return (await streamChatCompletion(config, messages, options)).content;
}

function isRetryable(error: unknown): error is AiRequestError {
  return error instanceof AiRequestError
    && (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'server' || error.kind === 'rate-limit');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiRequestError('network', 'request cancelled'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new AiRequestError('network', 'request cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Non-streaming request with bounded exponential backoff for transient
 *  failures. Authentication and malformed responses are never retried. */
export async function requestChatWithRetry(
  config: AiChatConfig,
  messages: AiChatMessage[],
  options: AiRetryOptions = {},
): Promise<string> {
  const retries = Math.max(0, options.retries ?? 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await requestChat(config, messages, options);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === retries || options.signal?.aborted) throw error;
      const wait = error.retryAfterMs ?? Math.min(baseDelayMs * 2 ** attempt, 8_000);
      await delay(wait, options.signal);
    }
  }

  throw lastError;
}

/** Convert a chat-completions endpoint into its sibling models endpoint. */
export function deriveModelsUrl(endpoint: string): string {
  const clean = endpoint.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(clean)) return clean.replace(/\/chat\/completions$/i, '/models');
  return `${clean}/models`;
}

/** List model IDs exposed by an OpenAI-compatible endpoint. */
export async function listModels(
  config: Pick<AiChatConfig, 'endpoint' | 'apiKey'>,
  options: AiChatOptions = {},
): Promise<string[]> {
  const endpoint = config.endpoint?.trim();
  if (!endpoint) throw new AiRequestError('http', 'AI endpoint is empty');

  const timeoutMs = options.timeoutMs ?? 15_000;
  const context = createRequestContext(timeoutMs, options.signal);
  try {
    let response: Response;
    try {
      response = await fetch(deriveModelsUrl(endpoint), {
        method: 'GET',
        headers: requestHeaders(config.apiKey),
        signal: context.controller.signal,
      });
    } catch (error) {
      if (context.controller.signal.aborted) throw abortError(context, timeoutMs);
      throw new AiRequestError('network', error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw await responseError(response);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiRequestError('parse', 'models endpoint returned non-JSON');
    }
    return parseModelIds(payload);
  } catch (error) {
    if (context.controller.signal.aborted) throw abortError(context, timeoutMs);
    if (error instanceof AiRequestError
      && error.kind === 'network'
      && !options.signal?.aborted
      && isTauriRuntime()) {
      return parseModelIds(await nativeGet(deriveModelsUrl(endpoint), config.apiKey));
    }
    throw error;
  } finally {
    context.cleanup();
  }
}

/** Verify that an endpoint is reachable. Falls back to a one-token chat when
 *  the provider does not expose /models (some local servers only implement the
 *  completions route). */
export async function testConnection(
  config: AiChatConfig,
  options: AiChatOptions = {},
): Promise<AiConnectionResult> {
  try {
    const models = await listModels(config, options);
    return { ok: true, models };
  } catch (error) {
    if (!(error instanceof AiRequestError) || error.kind !== 'http' || (error.status !== 404 && error.status !== 405)) {
      return { ok: false, models: [], error: error instanceof AiRequestError ? error : undefined };
    }
  }

  try {
    await requestChat(
      { ...config, maxTokens: 1, temperature: 0 },
      [{ role: 'user', content: 'ping' }],
      options,
    );
    return { ok: true, models: [] };
  } catch (error) {
    return { ok: false, models: [], error: error instanceof AiRequestError ? error : undefined };
  }
}
