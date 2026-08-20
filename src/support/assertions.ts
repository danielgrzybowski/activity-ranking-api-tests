import { AssertionError } from 'node:assert';
import type { ZodSchema } from 'zod';
import type { ApiResponse } from './api-client';

/**
 * Assertion helpers tuned for readable failures.
 *
 * Messages name the reason something failed and quote the offending value.
 * Where prose is involved the assertions look for the substring that carries
 * the meaning rather than pinning an exact sentence, so wording can be
 * improved without a test edit.
 */

function preview(response: ApiResponse): string {
  const body = response.rawBody.length > 600 ? `${response.rawBody.slice(0, 600)}...` : response.rawBody;
  return `${response.url}\n  body: ${body || '<empty>'}`;
}

export function expectStatus(response: ApiResponse, expected: number): void {
  if (response.status !== expected) {
    throw new AssertionError({
      message: `Expected HTTP ${expected} but got ${response.status} from ${preview(response)}`,
      actual: response.status,
      expected,
    });
  }
}

export function expectHeaderContains(response: ApiResponse, header: string, expected: string): void {
  const actual = response.headers.get(header);
  if (actual === null) {
    throw new AssertionError({
      message: `Expected a "${header}" response header, but it was absent. Headers present: ${[...response.headers.keys()].join(', ') || '<none>'}`,
    });
  }
  if (!actual.toLowerCase().includes(expected.toLowerCase())) {
    throw new AssertionError({
      message: `Expected "${header}" to contain "${expected}", got "${actual}"`,
      actual,
      expected,
    });
  }
}

export function parseWith<T>(schema: ZodSchema<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new AssertionError({
      message: `${label} does not match the documented contract:\n${issues}\n  received: ${JSON.stringify(value)}`,
    });
  }
  return result.data;
}

export function expectEqual<T>(actual: T, expected: T, what: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError({
      message: `Expected ${what} to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      actual,
      expected,
    });
  }
}

export function expectDeepEqual(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new AssertionError({
      message: `Expected ${what} to be ${b}, got ${a}`,
      actual,
      expected,
    });
  }
}

export function expectTrue(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError({ message });
}

/** Case-insensitive substring check, for prose we do not want to pin exactly. */
export function expectMentions(text: string, needle: string, what: string): void {
  if (!text.toLowerCase().includes(needle.toLowerCase())) {
    throw new AssertionError({
      message: `Expected ${what} to mention "${needle}", got "${text}"`,
    });
  }
}

export function expectMentionsAny(text: string, needles: string[], what: string): void {
  const hit = needles.some((n) => text.toLowerCase().includes(n.toLowerCase()));
  if (!hit) {
    throw new AssertionError({
      message: `Expected ${what} to mention one of [${needles.join(', ')}], got "${text}"`,
    });
  }
}

export function expectWithin(actual: number, budgetMs: number, what: string): void {
  if (actual > budgetMs) {
    throw new AssertionError({
      message: `Expected ${what} to complete within ${budgetMs}ms, took ${Math.round(actual)}ms`,
    });
  }
}
