import { DataTable, Then, When } from '@cucumber/cucumber';
import { callApi } from '../../src/support/api-client';
import { expectEqual, expectTrue, parseWith } from '../../src/support/assertions';
import { LocationsResponseSchema } from '../../src/support/schemas';
import type { ActivityRankingWorld } from '../../src/support/world';

const LOCATIONS_PATH = '/v1/locations';

When(
  'I search for locations matching {string}',
  async function (this: ActivityRankingWorld, query: string) {
    this.response = await callApi({ path: LOCATIONS_PATH, query: { q: query } });
  },
);

When(
  'I search for locations matching {string} with a limit of {int}',
  async function (this: ActivityRankingWorld, query: string, limit: number) {
    this.response = await callApi({ path: LOCATIONS_PATH, query: { q: query, limit } });
  },
);

// Quoted limits are the invalid ones: "0", "21", "many".
When(
  'I search for locations matching {string} with a limit of {string}',
  async function (this: ActivityRankingWorld, query: string, limit: string) {
    this.response = await callApi({ path: LOCATIONS_PATH, query: { q: query, limit } });
  },
);

When('I request locations with no query parameter', async function (this: ActivityRankingWorld) {
  this.response = await callApi({ path: LOCATIONS_PATH });
});

Then('the response matches the locations contract', function (this: ActivityRankingWorld) {
  parseWith(LocationsResponseSchema, this.lastResponse.body, 'The locations response');
});

Then(
  'the search returns {int} result(s)',
  function (this: ActivityRankingWorld, expected: number) {
    const results = this.locations().results;
    expectTrue(
      results.length === expected,
      `Expected ${expected} search result(s), got ${results.length}: ` +
        `[${results.map((r) => r.displayName).join(' | ') || '<none>'}]`,
    );
  },
);

Then(
  'the search results include {string}',
  function (this: ActivityRankingWorld, displayName: string) {
    const found = this.locations().results.map((r) => r.displayName);
    expectTrue(
      found.includes(displayName),
      `Expected the results to include "${displayName}", got [${found.join(' | ') || '<none>'}]`,
    );
  },
);

/**
 * Order matters here: the most prominent place has to be first or the
 * front end's default selection is wrong for the majority of users.
 */
Then('the search results are, in order:', function (this: ActivityRankingWorld, table: DataTable) {
  const expected = table.hashes().map((row) => row['displayName']!);
  const actual = this.locations().results.map((r) => r.displayName);
  expectTrue(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected results in this order:\n  ${expected.join('\n  ')}\nGot:\n  ${actual.join('\n  ') || '<none>'}`,
  );
});

Then('every result has a distinct display name', function (this: ActivityRankingWorld) {
  const names = this.locations().results.map((r) => r.displayName);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  expectTrue(
    duplicates.length === 0,
    `A picker cannot distinguish duplicate entries. Repeated display names: ${[...new Set(duplicates)].join(', ')}`,
  );
});

Then(
  'every result has its own coordinates, country and timezone',
  function (this: ActivityRankingWorld) {
    const results = this.locations().results;
    expectTrue(results.length > 1, 'This check needs more than one result to be meaningful.');

    const keys = results.map((r) => `${r.latitude},${r.longitude}`);
    const duplicates = keys.filter((key, i) => keys.indexOf(key) !== i);
    expectTrue(
      duplicates.length === 0,
      `Two results share coordinates (${duplicates.join('; ')}), so they are not distinct places.`,
    );

    for (const result of results) {
      expectTrue(
        result.country.length > 0 && result.timezone.length > 0,
        `Result "${result.displayName}" is missing a country or timezone, which the UI needs to disambiguate it.`,
      );
    }
  },
);

Then('the response body carries no error', function (this: ActivityRankingWorld) {
  const body = this.lastResponse.body as Record<string, unknown> | undefined;
  expectTrue(
    body !== undefined && !('error' in body),
    `Expected a plain result payload, but the body carried an error: ${this.lastResponse.rawBody.slice(0, 300)}`,
  );
});

/**
 * A typeahead fires a request per keystroke and they come back out of order.
 * Echoing the query is what lets the front end drop a stale response.
 */
Then('the echoed query is {string}', function (this: ActivityRankingWorld, expected: string) {
  expectEqual(this.locations().query, expected, 'the echoed query');
});
