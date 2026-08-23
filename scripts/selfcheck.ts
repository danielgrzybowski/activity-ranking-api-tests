/**
 * Proves the test harness itself works, independently of the API under test.
 *
 * The spec suite is red by design until the API exists, which makes it a poor
 * signal for "is my tooling broken?". This script answers that question: it
 * boots the Open-Meteo double, exercises the behaviours the feature files
 * rely on, and checks the contract schemas accept a well-formed payload and
 * reject a broken one.
 *
 *   npm run selfcheck
 */

import { strict as assert } from 'node:assert';
import { FakeOpenMeteo } from '../src/support/fake-open-meteo';
import { DEFAULT_PLACES } from '../src/support/fixtures/places';
import { WEATHER_PROFILES, getProfile } from '../src/support/fixtures/weather-profiles';
import { ACTIVITIES, explainsVerdict, ratingForScore, sharedReasonings } from '../src/support/domain';
import { LocationsResponseSchema, RankingsResponseSchema } from '../src/support/schemas';

const checks: { name: string; run: () => Promise<void> | void }[] = [];
const check = (name: string, run: () => Promise<void> | void): void => void checks.push({ name, run });

const fake = new FakeOpenMeteo();
const CHAMONIX = DEFAULT_PLACES.find((p) => p.name === 'Chamonix')!;

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url);
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: undefined };
  }
}

const forecastUrl = (days = 7): string =>
  `${fake.forecastBaseUrl}/v1/forecast?latitude=${CHAMONIX.latitude}&longitude=${CHAMONIX.longitude}` +
  `&forecast_days=${days}&daily=temperature_2m_max,snowfall_sum&timezone=auto`;

function reset(): void {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
}

check('geocoding matches a partial name and leaves the ordering to the API', async () => {
  reset();
  const { status, body } = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Lond&count=10`);
  assert.equal(status, 200);
  // Catalogue order, deliberately not population order: a double that
  // pre-sorted would let a passthrough pass the "most prominent first" spec.
  assert.deepEqual(
    body.results.map((r: any) => `${r.name}, ${r.admin1}`),
    ['London, Ohio', 'London, Ontario', 'London, England'],
  );
});

check('the double reproduces the gaps in real Open-Meteo payloads', async () => {
  reset();
  fake.setPlaces([
    { id: 1, name: 'Nazare', country: 'Portugal', country_code: 'PT', latitude: 39.6, longitude: -9.07, timezone: 'Europe/Lisbon', population: null },
  ]);

  const match = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Naza`);
  assert.equal('admin1' in match.body.results[0], false, 'an unknown region is an absent key, not null');
  assert.equal('population' in match.body.results[0], false, 'an unknown population is an absent key');

  const noCountry = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Naza`);
  assert.equal('country' in noCountry.body.results[0], true, 'a known country is still sent');

  fake.setPlaces([
    { id: 2, name: 'London', country_code: 'GP', latitude: 16.26487, longitude: -61.48832, timezone: 'America/Guadeloupe', population: null },
  ]);
  const gp = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=London`);
  assert.equal('country' in gp.body.results[0], false, 'a missing country is an absent key too');
  assert.equal(gp.body.results[0].country_code, 'GP', 'the code is there even when the name is not');

  const none = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Qwertyville`);
  assert.equal('results' in none.body, false, 'no matches omits `results` entirely, as the real service does');
});

check('geocoding is accent-insensitive, resolves by id, and 404s an unknown one', async () => {
  reset();
  // The live catalogue spells it "Zurich" under language=en, so the accent is
  // on the query side: what a user types has to reach a plainly-spelled town.
  const accented = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=z%C3%BCrich`);
  assert.equal(accented.body.results[0].name, 'Zurich');

  const found = await getJson(`${fake.geocodingBaseUrl}/v1/get?id=${CHAMONIX.id}`);
  assert.equal(found.body.timezone, 'Europe/Paris');
  assert.equal((await getJson(`${fake.geocodingBaseUrl}/v1/get?id=99999999`)).status, 404);
});

check('forecasts are per-day, consecutive from a fixed first date, and truncatable', async () => {
  reset();
  fake.setForecastDay(CHAMONIX.id, 1, 'BLIZZARD');
  fake.setForecastDay(CHAMONIX.id, 3, 'PERFECT_SUMMER_DAY');
  const { body } = await getJson(forecastUrl());

  assert.equal(body.daily.snowfall_sum[0], getProfile('BLIZZARD').daily.snowfall_sum);
  assert.equal(body.daily.temperature_2m_max[2], getProfile('PERFECT_SUMMER_DAY').daily.temperature_2m_max);
  assert.equal(body.daily.time[0], fake.firstForecastDate);
  const start = new Date(`${fake.firstForecastDate}T00:00:00Z`).getTime();
  body.daily.time.forEach((date: string, i: number) => {
    assert.equal(date, new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  });

  reset();
  fake.setForecastDayCount(4);
  fake.setUniformForecast(CHAMONIX.id, 'MILD_OVERCAST_DAY');
  assert.equal((await getJson(forecastUrl())).body.daily.time.length, 4);
});

check('upstream failure modes are reproducible, including the hang', async () => {
  reset();

  fake.forecastBehaviour = 'server_error';
  assert.equal((await getJson(forecastUrl())).status, 500);

  fake.forecastBehaviour = 'rate_limited';
  const limited = await fetch(forecastUrl());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  await limited.text();

  fake.forecastBehaviour = 'malformed';
  assert.equal((await getJson(forecastUrl())).body, undefined);

  fake.forecastBehaviour = 'timeout';
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(fetch(forecastUrl(), { signal: controller.signal }));
});

check('requests are recorded for the "what did we ask Open-Meteo" assertions', async () => {
  reset();
  await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Cham`);
  await getJson(forecastUrl());
  assert.equal(fake.requestsFor('geocoding').length, 1);
  assert.equal(fake.requestsFor('forecast')[0]!.query['forecast_days'], '7');
});

check('the weather profiles are internally consistent', () => {
  for (const [key, profile] of WEATHER_PROFILES) {
    assert.ok(profile.description.length > 0, `${key} needs a description for failure messages`);
    assert.ok(profile.daily.wind_gusts_10m_max >= profile.daily.wind_speed_10m_max, `${key} has gusts below the sustained wind`);
  }
});

check('a reasoning that explains nothing is rejected, whatever its length', () => {
  // The check runs against every 200 the suite receives, so a hole in it is
  // silent: nothing would ever fail differently. These are the sentences an
  // implementation actually produces when the copy is written before the model.
  const cases: [string, boolean, boolean][] = [
    ['Clear skies and 22°C.', true, true],
    ['A steady 24 km/h wind - workable swell.', true, true],
    ['25cm of fresh powder.', true, true],
    ['Conditions are suitable.', true, false],
    ['Rated 3 of 5 by our model.', true, false],
    ['This location has no coast within reach.', false, true],
    // Infeasible, and the prose talks about the weather instead of the reason.
    // The user reads a bad idea as a bad week.
    ['Only 8 km/h of wind today.', false, false],
  ];
  for (const [reasoning, feasible, expected] of cases) {
    assert.equal(
      explainsVerdict(reasoning, feasible),
      expected,
      `"${reasoning}" (feasible: ${feasible}) must be ${expected ? 'accepted' : 'rejected'}`,
    );
  }
});

check('two activities explained by the same sentence are caught', () => {
  // Also silent if it has a hole: this runs against every 200 the suite sees,
  // so a broken rule fails nothing and looks exactly like a passing one.
  const distinct = sharedReasonings([
    { activity: 'SKIING', reasoning: '25cm of fresh powder at -4°C.' },
    { activity: 'OUTDOOR_SIGHTSEEING', reasoning: 'Clear skies, dry and 22°C.' },
  ]);
  assert.equal(distinct.length, 0, 'two different sentences are not a collision');

  // Case and whitespace are formatting, not meaning: still the same sentence.
  const shared = sharedReasonings([
    { activity: 'OUTDOOR_SIGHTSEEING', reasoning: 'Clear skies, dry and 22°C.' },
    { activity: 'INDOOR_SIGHTSEEING', reasoning: 'clear skies,  dry and 22°C. ' },
    { activity: 'SKIING', reasoning: 'No snow at 22°C.' },
  ]);
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0]!.activities, ['OUTDOOR_SIGHTSEEING', 'INDOOR_SIGHTSEEING']);
});

check('the contract schemas accept a good payload and reject the ways it can go wrong', () => {
  const location = {
    id: '3027301', name: 'Chamonix', country: 'France', countryCode: 'FR',
    region: 'Rhône-Alpes', latitude: 45.92375, longitude: 6.86933,
    timezone: 'Europe/Paris', population: 10614,
    displayName: 'Chamonix, Rhône-Alpes, France',
  };
  const day = {
    date: '2026-08-20',
    activities: ACTIVITIES.map((activity, i) => ({
      activity, feasible: true, score: 80 - i * 10, rating: ratingForScore(80 - i * 10),
      rank: i + 1, reasoning: 'Clear skies and 22°C.',
    })),
  };
  const rankings = {
    location, generatedAt: new Date().toISOString(),
    forecast: { source: 'open-meteo', timezone: 'Europe/Paris', days: 1 },
    units: { temperature: '°C', precipitation: 'mm', snowfall: 'cm', windSpeed: 'km/h' },
    days: [day],
  };

  const cases: [string, unknown, boolean][] = [
    ['a well-formed rankings response', rankings, true],
    ['an undocumented field', { ...rankings, extra: true }, false],
    ['a day missing an activity', { ...rankings, days: [{ ...day, activities: day.activities.slice(0, 3) }] }, false],
    ['an entry with no feasibility flag', { ...rankings, days: [{ ...day, activities: day.activities.map(({ feasible, ...rest }) => rest) }] }, false],
  ];
  for (const [what, value, ok] of cases) {
    assert.equal(RankingsResponseSchema.safeParse(value).success, ok, `${what} must ${ok ? 'pass' : 'fail'}`);
  }

  const locationCases: [string, unknown, boolean][] = [
    ['a location with unknown region and population', { query: 'Naza', count: 1, results: [{ ...location, region: null, population: null }] }, true],
    ['count disagreeing with results.length', { query: 'Cham', count: 2, results: [location] }, false],
    ['an empty-string region, which is a formatting bug', { query: 'Naza', count: 1, results: [{ ...location, region: '' }] }, false],
  ];
  for (const [what, value, ok] of locationCases) {
    assert.equal(LocationsResponseSchema.safeParse(value).success, ok, `${what} must ${ok ? 'pass' : 'fail'}`);
  }
});

await fake.start(0);
let failed = 0;
for (const { name, run } of checks) {
  try {
    await run();
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (error) {
    failed += 1;
    process.stdout.write(`  FAIL  ${name}\n        ${(error as Error).message}\n`);
  }
}
await fake.stop();

process.stdout.write(`\n${checks.length - failed}/${checks.length} harness checks passed\n`);
if (failed > 0) {
  process.stdout.write('The test harness itself is broken - fix this before reading the suite.\n');
  process.exit(1);
}
process.stdout.write('The harness is sound. Any red in the spec suite is the missing API, not the tooling.\n');
