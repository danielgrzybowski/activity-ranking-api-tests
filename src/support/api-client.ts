import type { APIRequestContext } from '@playwright/test';
import { config } from './config';

export interface ApiResponse {
  status: number;
  headers: Headers;
  /** Parsed JSON, or `undefined` when the body was not valid JSON. */
  body: unknown;
  rawBody: string;
  durationMs: number;
  url: string;
}

export class ApiUnreachableError extends Error {
  constructor(url: string, cause: unknown) {
    super(
      `Could not reach the Activity Ranking API at ${url}.\n` +
        `  This suite is spec-first: it describes an API that does not exist yet.\n` +
        `  Start the implementation (or point API_BASE_URL at it) to turn these red scenarios green.\n` +
        `  Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ApiUnreachableError';
  }
}

export interface RequestOptions {
  path: string;
  query?: Record<string, string | number | undefined>;
  method?: string;
  headers?: Record<string, string>;
}

export function buildUrl(path: string, query: RequestOptions['query'] = {}): string {
  const url = new URL(path, `${config.apiBaseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Calls the API through Playwright's request context rather than bare fetch,
 * so every call lands in the trace and the HTML report alongside its
 * assertions. The returned shape is deliberately runner-agnostic: the
 * assertion helpers and invariants know nothing about Playwright.
 */
export async function callApi(
  request: APIRequestContext,
  options: RequestOptions,
): Promise<ApiResponse> {
  const url = buildUrl(options.path, options.query);
  const startedAt = performance.now();

  try {
    const response = await request.fetch(url, {
      method: options.method ?? 'GET',
      headers: { accept: 'application/json', ...options.headers },
      timeout: config.apiTimeoutMs,
      // Non-2xx is data here, not an exception: most scenarios assert on it.
      failOnStatusCode: false,
    });

    const rawBody = await response.text();
    const durationMs = performance.now() - startedAt;

    let body: unknown;
    try {
      body = rawBody === '' ? undefined : JSON.parse(rawBody);
    } catch {
      body = undefined;
    }

    return {
      status: response.status(),
      headers: new Headers(response.headers()),
      body,
      rawBody,
      durationMs,
      url,
    };
  } catch (error) {
    throw new ApiUnreachableError(url, error);
  }
}
