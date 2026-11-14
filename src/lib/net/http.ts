// Small HTTP text transport shared by external data sources. The packaged
// app goes through a Rust command so webview CORS rules never apply; browser
// dev/e2e uses fetch directly (tests point the base URLs at a local mock).

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '$lib/backend/api';

export interface HttpTextOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpTextResponse {
  status: number;
  text: string;
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export async function httpText(url: string, options: HttpTextOptions = {}): Promise<HttpTextResponse> {
  const method = options.method ?? 'GET';
  if (isTauri()) {
    const out = await invoke<{ status: number; body: string }>('http_request', {
      method,
      url,
      headers: options.headers ?? {},
      body: options.body ?? null,
    });
    return { status: out.status, text: out.body };
  }

  const response = await fetch(url, {
    method,
    headers: options.headers,
    body: options.body,
    signal: options.signal,
  });
  return { status: response.status, text: await response.text() };
}

export function formBody(fields: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}
