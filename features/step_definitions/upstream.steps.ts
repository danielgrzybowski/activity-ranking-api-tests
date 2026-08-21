import type { DataTable } from 'playwright-bdd';
import { expectTrue } from '../../src/support/assertions';
import type { GeoPlace } from '../../src/support/fake-open-meteo';
import { DEFAULT_PLACES } from '../../src/support/fixtures/places';
import { Given, Then } from '../../src/support/fixtures';

/**
 * Steps that drive the Open-Meteo test double: what places exist, what the
 * weather is, and how the upstream misbehaves.
 */

interface PlaceRow {
  id: string;
  name: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: string;
  longitude: string;
  timezone: string;
  population: string;
}

function toPlace(row: PlaceRow): GeoPlace {
  return {
    id: Number.parseInt(row.id, 10),
    name: row.name,
    admin1: row.region,
    country: row.country,
    country_code: row.countryCode,
    latitude: Number.parseFloat(row.latitude),
    longitude: Number.parseFloat(row.longitude),
    timezone: row.timezone,
    population: Number.parseInt(row.population, 10),
  };
}

Given("Open-Meteo's place catalogue contains:", async ({ upstream }, table: DataTable) => {
  upstream.setPlaces(table.hashes().map((row) => toPlace(row as unknown as PlaceRow)));
});

Given("Open-Meteo's place catalogue contains the standard test cities", async ({ upstream }) => {
  upstream.setPlaces(DEFAULT_PLACES);
});

Given(
  'every day of the forecast for {string} is a {string}',
  async ({ upstream }, label: string, profileKey: string) => {
    upstream.setUniformForecast(upstream.findPlaceByLabel(label).id, profileKey);
  },
);

Given(
  'day {int} of the forecast for {string} is a {string}',
  async ({ upstream }, dayNumber: number, label: string, profileKey: string) => {
    upstream.setForecastDay(upstream.findPlaceByLabel(label).id, dayNumber, profileKey);
  },
);

Given('the forecast for {string} is:', async ({ upstream }, label: string, table: DataTable) => {
  const placeId = upstream.findPlaceByLabel(label).id;
  for (const row of table.hashes()) {
    upstream.setForecastDay(placeId, Number.parseInt(row['day']!, 10), row['profile']!);
  }
});

Given('Open-Meteo only has {int} days of forecast', async ({ upstream }, days: number) => {
  upstream.setForecastDayCount(days);
});

Given("Open-Meteo's forecast service is returning server errors", async ({ upstream }) => {
  upstream.forecastBehaviour = 'server_error';
});

Given("Open-Meteo's geocoding service is returning server errors", async ({ upstream }) => {
  upstream.geocodingBehaviour = 'server_error';
});

Given("Open-Meteo's forecast service never responds", async ({ upstream }) => {
  upstream.forecastBehaviour = 'timeout';
});

Given("Open-Meteo's forecast service is rate limiting", async ({ upstream }) => {
  upstream.forecastBehaviour = 'rate_limited';
});

Given("Open-Meteo's forecast service is returning malformed data", async ({ upstream }) => {
  upstream.forecastBehaviour = 'malformed';
});

// --- assertions about how the API used Open-Meteo ---------------------------

Then("Open-Meteo's forecast service was not called", async ({ upstream }) => {
  const calls = upstream.requestsFor('forecast');
  expectTrue(
    calls.length === 0,
    `Expected no forecast calls, but ${calls.length} were made: ` +
      `${calls.map((c) => JSON.stringify(c.query)).join(', ')}`,
  );
});

Then("Open-Meteo's geocoding service was called", async ({ upstream }) => {
  expectTrue(
    upstream.requestsFor('geocoding').length > 0,
    'Expected the API to call Open-Meteo geocoding, but it made no such call.',
  );
});

Then("Open-Meteo's forecast service was called once", async ({ upstream }) => {
  const calls = upstream.requestsFor('forecast');
  expectTrue(
    calls.length === 1,
    `Expected exactly 1 forecast call, got ${calls.length}. Forecast quota is finite.`,
  );
});

Then("Open-Meteo's geocoding service was called at most once", async ({ upstream }) => {
  const calls = upstream.requestsFor('geocoding');
  expectTrue(calls.length <= 1, `Expected at most 1 geocoding call, got ${calls.length}.`);
});

Then('the forecast request used the coordinates of {string}', async ({ upstream }, label: string) => {
  const place = upstream.findPlaceByLabel(label);
  const call = upstream.requestsFor('forecast')[0];
  expectTrue(call !== undefined, 'Expected a forecast call to have been made, but there was none.');

  const latitude = Number.parseFloat(call!.query['latitude'] ?? 'NaN');
  const longitude = Number.parseFloat(call!.query['longitude'] ?? 'NaN');
  const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

  expectTrue(
    close(latitude, place.latitude) && close(longitude, place.longitude),
    `Expected the forecast to be requested for ${label} (${place.latitude}, ${place.longitude}), ` +
      `but it asked for (${latitude}, ${longitude}).`,
  );
});

Then('the forecast request asked for {int} days', async ({ upstream }, days: number) => {
  const call = upstream.requestsFor('forecast')[0];
  expectTrue(call !== undefined, 'Expected a forecast call to have been made, but there was none.');
  expectTrue(
    call!.query['forecast_days'] === String(days),
    `Expected forecast_days=${days}, got ${JSON.stringify(call!.query['forecast_days'])}. ` +
      `Relying on the upstream default would silently change the window.`,
  );
});

Then('the forecast request asked for the daily variables:', async ({ upstream }, table: DataTable) => {
  const call = upstream.requestsFor('forecast')[0];
  expectTrue(call !== undefined, 'Expected a forecast call to have been made, but there was none.');

  const requested = (call!.query['daily'] ?? '').split(',').map((v) => v.trim());
  const missing = table.raw().map((row) => row[0]!).filter((v) => !requested.includes(v));

  expectTrue(
    missing.length === 0,
    `The forecast request is missing daily variables the ranking needs: ${missing.join(', ')}. ` +
      `It asked for: ${requested.join(', ') || '<none>'}`,
  );
});
