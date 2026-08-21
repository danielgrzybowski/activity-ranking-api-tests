import type { DataTable } from 'playwright-bdd';
import { expectEqual, expectTrue, parseWith } from '../../src/support/assertions';
import { Then, When } from '../../src/support/fixtures';
import { LocationsResponseSchema } from '../../src/support/schemas';

const LOCATIONS_PATH = '/v1/locations';

When('I search for locations matching {string}', async ({ api }, query: string) => {
  await api.call({ path: LOCATIONS_PATH, query: { q: query } });
});

When(
  'I search for locations matching {string} with a limit of {int}',
  async ({ api }, query: string, limit: number) => {
    await api.call({ path: LOCATIONS_PATH, query: { q: query, limit } });
  },
);

// Quoted limits are the invalid ones: "0", "21", "many".
When(
  'I search for locations matching {string} with a limit of {string}',
  async ({ api }, query: string, limit: string) => {
    await api.call({ path: LOCATIONS_PATH, query: { q: query, limit } });
  },
);

When('I request locations with no query parameter', async ({ api }) => {
  await api.call({ path: LOCATIONS_PATH });
});

Then('the response matches the locations contract', async ({ api }) => {
  parseWith(LocationsResponseSchema, api.lastResponse.body, 'The locations response');
});

Then('the search returns {int} result(s)', async ({ api }, expected: number) => {
  const results = api.locations().results;
  expectTrue(
    results.length === expected,
    `Expected ${expected} search result(s), got ${results.length}: ` +
      `[${results.map((r) => r.displayName).join(' | ') || '<none>'}]`,
  );
});

Then('the search results include {string}', async ({ api }, displayName: string) => {
  const found = api.locations().results.map((r) => r.displayName);
  expectTrue(
    found.includes(displayName),
    `Expected the results to include "${displayName}", got [${found.join(' | ') || '<none>'}]`,
  );
});

/**
 * Order matters here: the most prominent place has to be first or the
 * front end's default selection is wrong for the majority of users.
 */
Then('the search results are, in order:', async ({ api }, table: DataTable) => {
  const expected = table.hashes().map((row) => row['displayName']!);
  const actual = api.locations().results.map((r) => r.displayName);
  expectTrue(
    JSON.stringify(actual) === JSON.stringify(expected),
    `Expected results in this order:\n  ${expected.join('\n  ')}\nGot:\n  ${actual.join('\n  ') || '<none>'}`,
  );
});

Then('every result has a distinct display name', async ({ api }) => {
  const names = api.locations().results.map((r) => r.displayName);
  const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
  expectTrue(
    duplicates.length === 0,
    `A picker cannot distinguish duplicate entries. Repeated display names: ${[...new Set(duplicates)].join(', ')}`,
  );
});

Then('every result has its own coordinates, country and timezone', async ({ api }) => {
  const results = api.locations().results;
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
});

Then('the response body carries no error', async ({ api }) => {
  const body = api.lastResponse.body as Record<string, unknown> | undefined;
  expectTrue(
    body !== undefined && !('error' in body),
    `Expected a plain result payload, but the body carried an error: ${api.lastResponse.rawBody.slice(0, 300)}`,
  );
});

/**
 * A typeahead fires a request per keystroke and they come back out of order.
 * Echoing the query is what lets the front end drop a stale response.
 */
Then('the echoed query is {string}', async ({ api }, expected: string) => {
  expectEqual(api.locations().query, expected, 'the echoed query');
});
