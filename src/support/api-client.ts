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

/**
 * Nothing is listening. For this suite that is the expected state until the
 * implementation exists, so the message says so rather than looking like a bug.
 */
export class ApiUnreachableError extends Error {
  constructor(url: string, cause: unknown) {
    super(
      `Could not reach the Activity Ranking API at ${url}.\n` +
        `  Nothing is listening on that address.\n` +
        `  This suite is spec-first: it describes an API that does not exist yet.\n` +
        `  Start the implementation (or point API_BASE_URL at it) to turn these red scenarios green.\n` +
        `  Underlying error: ${describe(cause)}`,
    );
    this.name = 'ApiUnreachableError';
  }
}

/**
 * The API is there and took the connection, but did not answer in time. Kept
 * separate from ApiUnreachableError on purpose: "your API is too slow" and
 * "your API does not exist" are different defects, and the resilience
 * scenarios - where the API is expected to answer a hung upstream quickly -
 * are exactly where confusing the two costs an afternoon.
 */
export class ApiTimeoutError extends Error {
  constructor(url: string, timeoutMs: number, cause: unknown) {
    super(
      `The Activity Ranking API accepted the connection to ${url} but sent no response within ${timeoutMs}ms.\n` +
        `  The API is running; it is hanging. If this is an upstream-failure scenario, the API is\n` +
        `  waiting on Open-Meteo instead of giving up and answering the user.\n` +
        `  Underlying error: ${describe(cause)}`,
    );
    this.name = 'ApiTimeoutError';
  }
}

/** Anything else: TLS, a socket hangup, a malformed URL. */
export class ApiRequestFailedError extends Error {
  constructor(url: string, cause: unknown) {
    super(`The request to ${url} failed before a response was read.\n  Underlying error: ${describe(cause)}`);
    this.name = 'ApiRequestFailedError';
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const CONNECTION_REFUSED = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_CONNECTION_REFUSED|connect ECONN/i;
const TIMED_OUT = /timeout|timed out/i;

export interface RequestOptions {
  path: string;
  query?: Record<string, string | number | undefined>;
  /**
   * A query string appended verbatim, for input that must not be
   * percent-encoded on its way out (a raw NUL, say). Mutually exclusive
   * with `query`.
   */
  rawQuery?: string;
  method?: string;
  headers?: Record<string, string>;
}

export function buildUrl(
  path: string,
  query: RequestOptions['query'] = {},
  rawQuery?: string,
): string {
  const url = new URL(path, `${config.apiBaseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  // `url.search = raw` would re-encode; string concatenation does not.
  return rawQuery === undefined ? url.toString() : `${url.toString()}?${rawQuery}`;
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
  const url = buildUrl(options.path, options.query, options.rawQuery);
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
    const message = describe(error);
    if (CONNECTION_REFUSED.test(message)) throw new ApiUnreachableError(url, error);
    if (TIMED_OUT.test(message)) throw new ApiTimeoutError(url, config.apiTimeoutMs, error);
    throw new ApiRequestFailedError(url, error);
  }
}
