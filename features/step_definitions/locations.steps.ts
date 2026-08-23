import type { DataTable } from 'playwright-bdd';
import { expectEqual, expectTrue, parseWith } from '../../src/support/assertions';
import { Then, When } from '../../src/support/fixtures';
import { LocationsResponseSchema, type LocationsResponse } from '../../src/support/schemas';

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

Then('the search returns at least {int} result(s)', async ({ api }, minimum: number) => {
  const results = api.locations().results;
  expectTrue(
    results.length >= minimum,
    `Expected at least ${minimum} search result(s), got ${results.length}: ` +
      `[${results.map((r) => r.displayName).join(' | ') || '<none>'}]`,
  );
});

Then('the last result is {string}', async ({ api }, displayName: string) => {
  const found = api.locations().results.map((r) => r.displayName);
  expectTrue(
    found[found.length - 1] === displayName,
    `Expected "${displayName}" to sort last, got [${found.join(' | ') || '<none>'}]`,
  );
});

function resultNamed(results: LocationsResponse['results'], displayName: string) {
  const match = results.find((r) => r.displayName === displayName);
  if (!match) {
    throw new Error(
      `No result with the display name "${displayName}". Got: ` +
        `[${results.map((r) => r.displayName).join(' | ') || '<none>'}]`,
    );
  }
  return match;
}

/**
 * Open-Meteo has no population for thousands of small places. `null` says so
 * honestly; a 0 would sort and read as a fact about the town.
 */
Then('the result {string} has no population', async ({ api }, displayName: string) => {
  const result = resultNamed(api.locations().results, displayName);
  expectTrue(
    result.population === null,
    `Expected an unknown population to be reported as null, got ${JSON.stringify(result.population)}.`,
  );
});

/**
 * Open-Meteo files a handful of real places with a country code and no country
 * name. Dropping them would make a real place unreachable; inventing a name
 * from the code would be a fact the API made up.
 */
Then('the result {string} has no country', async ({ api }, displayName: string) => {
  const result = resultNamed(api.locations().results, displayName);
  expectTrue(
    result.country === null,
    `Expected a missing country to be reported as null, got ${JSON.stringify(result.country)}.`,
  );
});

Then('the result {string} has no region', async ({ api }, displayName: string) => {
  const result = resultNamed(api.locations().results, displayName);
  expectTrue(
    result.region === null,
    `Expected an unknown region to be reported as null, got ${JSON.stringify(result.region)}.`,
  );
});
