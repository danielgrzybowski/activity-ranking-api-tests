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
