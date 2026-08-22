import type { APIRequestContext } from '@playwright/test';
import { test as base, createBdd } from 'playwright-bdd';
import { callApi, type ApiResponse, type RequestOptions } from './api-client';
import { parseWith } from './assertions';
import { config } from './config';
import { fakeOpenMeteo, FakeOpenMeteo } from './fake-open-meteo';
import { asRankingsResponse, assertRankingInvariants } from './invariants';
import {
  ErrorResponseSchema,
  LocationsResponseSchema,
  RankingsResponseSchema,
  type ErrorResponse,
  type LocationsResponse,
  type RankingsResponse,
} from './schemas';

/**
 * Scenario state and the calls that produce it.
 *
 * This is what a Cucumber World would hold, expressed as a Playwright fixture
 * so it is created per test, typed at the point of use, and torn down by the
 * runner rather than by a hook.
 */
export class ApiSession {
  response: ApiResponse | undefined;
  /** A second call, for the determinism scenario. */
  repeatResponse: ApiResponse | undefined;
  /** Set when a scenario is standing in for a browser page. */
  origin: string | undefined;

  constructor(private readonly request: APIRequestContext) {}

  async call(options: RequestOptions): Promise<ApiResponse> {
    this.response = await callApi(this.request, this.withOrigin(options));
    return this.response;
  }

  async callAgain(options: RequestOptions): Promise<ApiResponse> {
    this.repeatResponse = await callApi(this.request, this.withOrigin(options));
    return this.repeatResponse;
  }

  private withOrigin(options: RequestOptions): RequestOptions {
    if (this.origin === undefined) return options;
    return { ...options, headers: { origin: this.origin, ...options.headers } };
  }

  get lastResponse(): ApiResponse {
    if (!this.response) throw new Error('No request has been made yet in this scenario.');
    return this.response;
  }

  rankings(): RankingsResponse {
    return parseWith(RankingsResponseSchema, this.lastResponse.body, 'The rankings response');
  }

  locations(): LocationsResponse {
    return parseWith(LocationsResponseSchema, this.lastResponse.body, 'The locations response');
  }

  errorBody(): ErrorResponse {
    return parseWith(ErrorResponseSchema, this.lastResponse.body, 'The error response');
  }
}

export const test = base.extend<
  { api: ApiSession; freshUpstream: void },
  { upstream: FakeOpenMeteo }
>({
  /**
   * One Open-Meteo double per worker. The API under test is a separate
   * process pointed at a fixed port, so it cannot be given a per-worker
   * instance -- which is exactly why the config pins `workers: 1`.
   */
  upstream: [
    async ({}, use) => {
      await fakeOpenMeteo.start(config.fakeUpstreamPort);
      await use(fakeOpenMeteo);
      await fakeOpenMeteo.stop();
    },
    { scope: 'worker', auto: true },
  ],

  /**
   * Auto fixture, so the double is clean before a scenario's first Given even
   * if that scenario never touches the `api` fixture.
   */
  freshUpstream: [
    async ({ upstream }, use) => {
      upstream.reset();
      await use();
    },
    { auto: true },
  ],

  api: async ({ request, upstream }, use, testInfo) => {
    const session = new ApiSession(request);

    await use(session);

    // What the API said and what it asked Open-Meteo for. Debugging a ranking
    // disagreement without both halves is guesswork.
    const attachDiagnostics = async (): Promise<void> => {
      if (session.response) {
        await testInfo.attach('api-response.json', {
          contentType: 'application/json',
          body: JSON.stringify(
            {
              url: session.response.url,
              status: session.response.status,
              durationMs: Math.round(session.response.durationMs),
              headers: Object.fromEntries(session.response.headers.entries()),
              body: session.response.body ?? session.response.rawBody,
            },
            null,
            2,
          ),
        });
      }
      if (upstream.requests.length > 0) {
        await testInfo.attach('open-meteo-requests.json', {
          contentType: 'application/json',
          body: JSON.stringify(
            upstream.requests.map((r) => ({ service: r.service, path: r.path, query: r.query })),
            null,
            2,
          ),
        });
      }
    };

    // Structural rules are held against every 200 the suite ever sees, not
    // only where a feature file names them. See invariants.ts for why.
    //
    // The failure is caught rather than thrown straight out: an invariant
    // breach is exactly the failure that needs the diagnostics attached, and
    // throwing here would skip them.
    let invariantFailure: unknown;
    if (testInfo.status === testInfo.expectedStatus) {
      try {
        for (const response of [session.response, session.repeatResponse]) {
          if (!response) continue;
          const rankings = asRankingsResponse(response.status, response.body);
          if (rankings) assertRankingInvariants(rankings);
        }
      } catch (error) {
        invariantFailure = error;
      }
    }

    if (invariantFailure !== undefined || testInfo.status !== testInfo.expectedStatus) {
      await attachDiagnostics();
    }
    if (invariantFailure !== undefined) throw invariantFailure;
  },
});

export const { Given, When, Then } = createBdd(test);
