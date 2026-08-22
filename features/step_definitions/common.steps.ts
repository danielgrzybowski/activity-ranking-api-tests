import {
  expectHeaderContains,
  expectMentions,
  expectStatus,
  expectTrue,
  expectWithin,
  parseWith,
} from '../../src/support/assertions';
import { LATENCY_BUDGET_MS } from '../../src/support/domain';
import { Given, Then } from '../../src/support/fixtures';
import { ErrorResponseSchema } from '../../src/support/schemas';

/**
 * A cheap liveness probe. Without it every scenario fails deep inside an
 * assertion; with it the failure says plainly that the API is not there yet,
 * which is the honest red state for a spec-first suite.
 */
Given('the Activity Ranking API is available', async ({ api }) => {
  const response = await api.call({ path: '/health' });
  expectStatus(response, 200);
});

Then('the response status is {int}', async ({ api }, expected: number) => {
  expectStatus(api.lastResponse, expected);
});

Then('the response status is one of {string}', async ({ api }, list: string) => {
  const allowed = list.split(',').map((s) => Number.parseInt(s.trim(), 10));
  expectTrue(
    allowed.includes(api.lastResponse.status),
    `Expected the status to be one of [${allowed.join(', ')}], got ${api.lastResponse.status}. ` +
      `Body: ${api.lastResponse.rawBody.slice(0, 300)}`,
  );
});

Then('the response matches the error contract', async ({ api }) => {
  parseWith(ErrorResponseSchema, api.lastResponse.body, 'The error response');
});

Then('the error code is {string}', async ({ api }, code: string) => {
  const body = api.errorBody();
  expectTrue(
    body.error.code === code,
    `Expected error code "${code}", got "${body.error.code}" (message: "${body.error.message}")`,
  );
});

Then('the error message mentions {string}', async ({ api }, needle: string) => {
  expectMentions(api.errorBody().error.message, needle, 'the error message');
});

/**
 * Asserted by meaning rather than by exact wording: the message has to tell
 * the user what the minimum is, but the copy team can rewrite the sentence.
 */
Then('the error message explains the minimum query length', async ({ api }) => {
  const message = api.errorBody().error.message;
  expectTrue(
    /2/.test(message) && /(character|length|short|least)/i.test(message),
    `Expected the error message to state the 2-character minimum, got "${message}"`,
  );
});

Then('the {string} header contains {string}', async ({ api }, header: string, expected: string) => {
  expectHeaderContains(api.lastResponse, header, expected);
});

Then('the {string} header is present', async ({ api }, header: string) => {
  expectTrue(
    api.lastResponse.headers.get(header) !== null,
    `Expected a "${header}" response header. Headers present: ` +
      `${[...api.lastResponse.headers.keys()].join(', ') || '<none>'}`,
  );
});

Then('the response arrived within the {string} latency budget', async ({ api }, budgetName: string) => {
  const budget = LATENCY_BUDGET_MS[budgetName as keyof typeof LATENCY_BUDGET_MS];
  if (budget === undefined) {
    throw new Error(
      `Unknown latency budget "${budgetName}". Known budgets: ${Object.keys(LATENCY_BUDGET_MS).join(', ')}`,
    );
  }
  expectWithin(api.lastResponse.durationMs, budget, `the ${budgetName} request`);
});

/**
 * Everything after this step is sent as a browser would send it. CORS
 * headers are conditional on `Origin` in most frameworks, so a scenario that
 * omits it is not testing what a front end will experience.
 */
Given('the request comes from the origin {string}', async ({ api }, origin: string) => {
  api.origin = origin;
});

Then('the response allows that origin', async ({ api }) => {
  const origin = api.origin;
  expectTrue(origin !== undefined, 'The scenario never set an origin to check against.');

  const allowed = api.lastResponse.headers.get('access-control-allow-origin');
  expectTrue(
    allowed === '*' || allowed === origin,
    `A browser at ${origin} would have blocked this response: ` +
      `"access-control-allow-origin" was ${allowed === null ? 'absent' : `"${allowed}"`}, ` +
      `which is neither "*" nor the requesting origin.`,
  );
});

/**
 * `Cache-Control: max-age=0` contains "max-age" and caches nothing, so the
 * header is asserted by what it permits rather than by what it says. A floor
 * rather than an exact value: how long a response stays fresh is the
 * implementation's call, but it has to be a real interval.
 *
 * `no-store` is checked separately because it does not clear `max-age` - the
 * two can be sent together, and the directive wins. A header saying both is
 * an implementation that believes it is caching and is not.
 */
Then('the response may be cached for at least {int} seconds', async ({ api }, seconds: number) => {
  const header = api.lastResponse.headers.get('cache-control');
  expectTrue(header !== null, 'Expected a "cache-control" header, but there was none.');

  expectTrue(
    !/\bno-store\b/i.test(header!),
    `"cache-control" is "${header}": "no-store" forbids the very caching the max-age beside it ` +
      `promises, and it is the directive that wins.`,
  );

  const maxAge = /max-age=(\d+)/i.exec(header!);
  expectTrue(
    maxAge !== null,
    `Expected "cache-control" to carry a max-age, got "${header}". Without one the front end has to ` +
      `re-fetch on every visit.`,
  );
  expectTrue(
    Number.parseInt(maxAge![1]!, 10) >= seconds,
    `Expected the response to stay fresh for at least ${seconds}s, got "${header}".`,
  );
});

/**
 * The contract allows either CORS implementation - a flat `*`, or the caller's
 * own origin echoed back - and asks for `Cache-Control: public` on the same
 * response. Those two only coexist safely with `Vary: Origin`: without it a
 * shared cache stores the first caller's `Access-Control-Allow-Origin` and
 * replays it to the next origin, whose browser then blocks a response it was
 * entitled to. It is an outage that only reproduces behind a CDN, which is to
 * say in production and nowhere else.
 *
 * `*` is the same answer for every caller, so it needs no `Vary` and the check
 * does not ask for one. That makes this assertion vacuous against an
 * implementation that sends `*`, which is why `mutation-run` carries an
 * `echo_origin_without_vary` defect: it is the only way to know the check
 * still fires.
 */
Then('a shared cache cannot hand this response to a different origin', async ({ api }) => {
  const allowed = api.lastResponse.headers.get('access-control-allow-origin');
  if (allowed === '*') return;

  const vary = api.lastResponse.headers.get('vary');
  const varies = (vary ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .includes('origin');

  expectTrue(
    varies,
    `"access-control-allow-origin" is "${allowed}" rather than "*", so this response differs per ` +
      `caller - but "vary" is ${vary === null ? 'absent' : `"${vary}"`}. A shared cache will serve ` +
      `${allowed}'s copy to the next origin, and that browser will block it.`,
  );
});
