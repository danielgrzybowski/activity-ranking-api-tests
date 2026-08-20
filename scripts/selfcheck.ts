/**
 * Proves the test harness itself works, independently of the API under test.
 *
 * The Cucumber suite is red by design until the API exists, which makes it a
 * poor signal for "is my tooling broken?". This script answers that question:
 * it boots the Open-Meteo double, exercises every behaviour the feature files
 * rely on, and checks the contract schemas accept a well-formed payload and
 * reject a broken one.
 *
 *   npm run selfcheck
 */

import { strict as assert } from 'node:assert';
import { FakeOpenMeteo } from '../src/support/fake-open-meteo';
import { DEFAULT_PLACES } from '../src/support/fixtures/places';
import { WEATHER_PROFILES, getProfile } from '../src/support/fixtures/weather-profiles';
import { ACTIVITIES, ratingForScore } from '../src/support/domain';
import { LocationsResponseSchema, RankingsResponseSchema } from '../src/support/schemas';

const checks: { name: string; run: () => Promise<void> | void }[] = [];
function check(name: string, run: () => Promise<void> | void): void {
  checks.push({ name, run });
}

const fake = new FakeOpenMeteo();

const CHAMONIX = DEFAULT_PLACES.find((p) => p.name === 'Chamonix-Mont-Blanc')!;

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

function forecastUrl(latitude: number, longitude: number, days = 7): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    forecast_days: String(days),
    daily: 'temperature_2m_max,snowfall_sum,wind_speed_10m_max',
    timezone: 'auto',
  });
  return `${fake.forecastBaseUrl}/v1/forecast?${params}`;
}

check('geocoding matches a partial name and orders by population', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  const { status, body } = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Lond&count=10`);
  assert.equal(status, 200);
  const names = body.results.map((r: any) => `${r.name}, ${r.admin1}`);
  assert.deepEqual(names, ['London, England', 'London, Ontario', 'London, Ohio']);
});

check('geocoding is accent-insensitive', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  const { body } = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=zurich`);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].name, 'Zürich');
});

check('geocoding omits `results` when nothing matches, as the real service does', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  const { status, body } = await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Qwertyville`);
  assert.equal(status, 200);
  assert.equal('results' in body, false, 'the double must reproduce the missing-results quirk');
});

check('geocoding resolves a place by id, and 404s an unknown one', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);

  const found = await getJson(`${fake.geocodingBaseUrl}/v1/get?id=${CHAMONIX.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.name, 'Chamonix-Mont-Blanc');
  assert.equal(found.body.timezone, 'Europe/Paris');

  const missing = await getJson(`${fake.geocodingBaseUrl}/v1/get?id=99999999`);
  assert.equal(missing.status, 404);
});

check('a uniform forecast returns seven days of the chosen profile', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  fake.setUniformForecast(CHAMONIX.id, 'ALPINE_POWDER_DAY');
  const { body } = await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude));
  assert.equal(body.daily.time.length, 7);
  assert.deepEqual(
    body.daily.snowfall_sum,
    new Array(7).fill(getProfile('ALPINE_POWDER_DAY').daily.snowfall_sum),
  );
  assert.equal(body.timezone, CHAMONIX.timezone);
});

check('per-day profiles land on the right day', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  fake.setForecastDay(CHAMONIX.id, 1, 'BLIZZARD');
  fake.setForecastDay(CHAMONIX.id, 3, 'PERFECT_SUMMER_DAY');
  const { body } = await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude));
  assert.equal(body.daily.snowfall_sum[0], getProfile('BLIZZARD').daily.snowfall_sum);
  assert.equal(body.daily.temperature_2m_max[2], getProfile('PERFECT_SUMMER_DAY').daily.temperature_2m_max);
});

check('dates are consecutive from the recorded first forecast day', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  fake.setUniformForecast(CHAMONIX.id, 'MILD_OVERCAST_DAY');
  const { body } = await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude));
  assert.equal(body.daily.time[0], fake.firstForecastDate);
  const start = new Date(`${fake.firstForecastDate}T00:00:00Z`).getTime();
  body.daily.time.forEach((date: string, i: number) => {
    assert.equal(date, new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  });
});

check('a short forecast window is honoured', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  fake.setForecastDayCount(4);
  fake.setUniformForecast(CHAMONIX.id, 'MILD_OVERCAST_DAY');
  const { body } = await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude));
  assert.equal(body.daily.time.length, 4);
});

check('upstream failure modes are reproducible', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);

  fake.forecastBehaviour = 'server_error';
  assert.equal((await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude))).status, 500);

  fake.forecastBehaviour = 'rate_limited';
  const limited = await fetch(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  await limited.text();

  fake.forecastBehaviour = 'malformed';
  assert.equal((await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude))).body, undefined);

  fake.forecastBehaviour = 'ok';
});

check('a hanging upstream really does hang', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  fake.forecastBehaviour = 'timeout';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  await assert.rejects(
    fetch(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude), { signal: controller.signal }),
    'the double should never answer while in timeout mode',
  );
  clearTimeout(timer);
  fake.forecastBehaviour = 'ok';
});

check('requests are recorded for the "what did we ask Open-Meteo" assertions', async () => {
  fake.reset();
  fake.setPlaces(DEFAULT_PLACES);
  fake.setUniformForecast(CHAMONIX.id, 'MILD_OVERCAST_DAY');
  await getJson(`${fake.geocodingBaseUrl}/v1/search?name=Cham`);
  await getJson(forecastUrl(CHAMONIX.latitude, CHAMONIX.longitude));

  assert.equal(fake.requestsFor('geocoding').length, 1);
  assert.equal(fake.requestsFor('forecast').length, 1);
  assert.equal(fake.requestsFor('forecast')[0]!.query['forecast_days'], '7');
});

check('every weather profile is well formed', () => {
  assert.ok(WEATHER_PROFILES.size >= 8, 'the specs need a spread of weather to be meaningful');
  for (const [key, profile] of WEATHER_PROFILES) {
    assert.equal(profile.key, key);
    assert.ok(profile.description.length > 0, `${key} needs a description for failure messages`);
    assert.ok(profile.daily.temperature_2m_max >= profile.daily.temperature_2m_min, `${key} has an inverted temperature range`);
    assert.ok(profile.daily.wind_gusts_10m_max >= profile.daily.wind_speed_10m_max, `${key} has gusts below the sustained wind`);
    assert.ok(profile.daily.snowfall_sum >= 0 && profile.daily.precipitation_sum >= 0, `${key} has negative precipitation`);
  }
});

check('rating bands cover 0-100 with no gaps', () => {
  for (let score = 0; score <= 100; score++) {
    assert.ok(ratingForScore(score), `score ${score} falls outside every band`);
  }
  assert.equal(ratingForScore(0), 'UNSUITABLE');
  assert.equal(ratingForScore(19), 'UNSUITABLE');
  assert.equal(ratingForScore(20), 'POOR');
  assert.equal(ratingForScore(59), 'FAIR');
  assert.equal(ratingForScore(80), 'EXCELLENT');
  assert.equal(ratingForScore(100), 'EXCELLENT');
});

check('the contract schemas accept a good payload and reject a bad one', () => {
  const location = {
    id: '3333129',
    name: 'Chamonix-Mont-Blanc',
    country: 'France',
    countryCode: 'FR',
    region: 'Auvergne-Rhone-Alpes',
    latitude: 45.92375,
    longitude: 6.86933,
    timezone: 'Europe/Paris',
    population: 8611,
    displayName: 'Chamonix-Mont-Blanc, Auvergne-Rhone-Alpes, France',
  };

  assert.equal(
    LocationsResponseSchema.safeParse({ query: 'Cham', count: 1, results: [location] }).success,
    true,
  );
  assert.equal(
    LocationsResponseSchema.safeParse({ query: 'Cham', count: 2, results: [location] }).success,
    false,
    'count and results.length must be checked against each other',
  );

  const day = {
    date: '2026-08-20',
    activities: ACTIVITIES.map((activity, i) => ({
      activity,
      score: 80 - i * 10,
      rating: ratingForScore(80 - i * 10),
      rank: i + 1,
      reasoning: 'Clear skies and 22°C.',
    })),
  };
  const rankings = {
    location,
    generatedAt: new Date().toISOString(),
    forecast: { source: 'open-meteo', timezone: 'Europe/Paris', days: 1 },
    units: { temperature: '°C', precipitation: 'mm', snowfall: 'cm', windSpeed: 'km/h' },
    days: [day],
  };

  assert.equal(RankingsResponseSchema.safeParse(rankings).success, true);
  assert.equal(
    RankingsResponseSchema.safeParse({ ...rankings, extra: true }).success,
    false,
    'undocumented fields are a contract change and must be caught',
  );
  assert.equal(
    RankingsResponseSchema.safeParse({
      ...rankings,
      days: [{ ...day, activities: day.activities.slice(0, 3) }],
    }).success,
    false,
    'a day missing an activity must be rejected',
  );
});

async function main(): Promise<void> {
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
  process.stdout.write(
    'The harness is sound. Any red in the Cucumber suite is the missing API, not the tooling.\n',
  );
}

await main();
