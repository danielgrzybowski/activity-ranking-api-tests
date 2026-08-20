import { Given, Then } from '@cucumber/cucumber';
import { callApi } from '../../src/support/api-client';
import {
  expectHeaderContains,
  expectMentions,
  expectStatus,
  expectTrue,
  expectWithin,
  parseWith,
} from '../../src/support/assertions';
import { LATENCY_BUDGET_MS } from '../../src/support/domain';
import { ErrorResponseSchema } from '../../src/support/schemas';
import type { ActivityRankingWorld } from '../../src/support/world';

/**
 * A cheap liveness probe. Without it every scenario fails deep inside an
 * assertion; with it the failure says plainly that the API is not there yet,
 * which is the honest red state for a spec-first suite.
 */
Given('the Activity Ranking API is available', async function (this: ActivityRankingWorld) {
  const response = await callApi({ path: '/health' });
  expectStatus(response, 200);
});

Then('the response status is {int}', function (this: ActivityRankingWorld, expected: number) {
  expectStatus(this.lastResponse, expected);
});

Then(
  'the response status is one of {string}',
  function (this: ActivityRankingWorld, list: string) {
    const allowed = list.split(',').map((s) => Number.parseInt(s.trim(), 10));
    expectTrue(
      allowed.includes(this.lastResponse.status),
      `Expected the status to be one of [${allowed.join(', ')}], got ${this.lastResponse.status}. ` +
        `Body: ${this.lastResponse.rawBody.slice(0, 300)}`,
    );
  },
);

Then('the response matches the error contract', function (this: ActivityRankingWorld) {
  parseWith(ErrorResponseSchema, this.lastResponse.body, 'The error response');
});

Then('the error code is {string}', function (this: ActivityRankingWorld, code: string) {
  const body = this.errorBody();
  expectTrue(
    body.error.code === code,
    `Expected error code "${code}", got "${body.error.code}" (message: "${body.error.message}")`,
  );
});

Then('the error message mentions {string}', function (this: ActivityRankingWorld, needle: string) {
  expectMentions(this.errorBody().error.message, needle, 'the error message');
});

/**
 * Asserted by meaning rather than by exact wording: the message has to tell
 * the user what the minimum is, but the copy team can rewrite the sentence.
 */
Then('the error message explains the minimum query length', function (this: ActivityRankingWorld) {
  const message = this.errorBody().error.message;
  expectTrue(
    /2/.test(message) && /(character|length|short|least)/i.test(message),
    `Expected the error message to state the 2-character minimum, got "${message}"`,
  );
});

Then(
  'the {string} header contains {string}',
  function (this: ActivityRankingWorld, header: string, expected: string) {
    expectHeaderContains(this.lastResponse, header, expected);
  },
);

Then('the {string} header is present', function (this: ActivityRankingWorld, header: string) {
  expectTrue(
    this.lastResponse.headers.get(header) !== null,
    `Expected a "${header}" response header. Headers present: ` +
      `${[...this.lastResponse.headers.keys()].join(', ') || '<none>'}`,
  );
});

Then(
  'the response arrived within the {string} latency budget',
  function (this: ActivityRankingWorld, budgetName: string) {
    const budget = LATENCY_BUDGET_MS[budgetName as keyof typeof LATENCY_BUDGET_MS];
    if (budget === undefined) {
      throw new Error(
        `Unknown latency budget "${budgetName}". Known budgets: ${Object.keys(LATENCY_BUDGET_MS).join(', ')}`,
      );
    }
    expectWithin(this.lastResponse.durationMs, budget, `the ${budgetName} request`);
  },
);
