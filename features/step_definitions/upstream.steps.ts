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
  /** Optional column: the county or district below `region`. */
  subregion?: string;
  country: string;
  countryCode: string;
  latitude: string;
  longitude: string;
  timezone: string;
  population: string;
  /** Optional column; blank or absent means a populated place. */
  featureCode?: string;
}

/**
 * An empty cell means Open-Meteo has no value for that field, which is a real
 * and common state rather than a hole in the fixture. The double then omits
 * the key entirely, as the live service does.
 */
function toPlace(row: PlaceRow): GeoPlace {
  const region = row.region.trim();
  const subregion = row.subregion?.trim() ?? '';
  const country = row.country.trim();
  const population = row.population.trim();
  return {
    id: Number.parseInt(row.id, 10),
    name: row.name,
    ...(region === '' ? {} : { admin1: region }),
    ...(subregion === '' ? {} : { admin2: subregion }),
    ...(country === '' ? {} : { country }),
    country_code: row.countryCode,
    latitude: Number.parseFloat(row.latitude),
    longitude: Number.parseFloat(row.longitude),
    timezone: row.timezone,
    population: population === '' ? null : Number.parseInt(population, 10),
    ...(row.featureCode?.trim() ? { feature_code: row.featureCode.trim() } : {}),
  };
}

Given("Open-Meteo's place catalogue contains:", async ({ upstream }, table: DataTable) => {
  upstream.setPlaces(table.hashes().map((row) => toPlace(row as unknown as PlaceRow)));
});

Given("Open-Meteo's place catalogue contains the standard test cities", async ({ upstream }) => {
  upstream.setPlaces(DEFAULT_PLACES);
});

Given(
  'every day of the forecast for {string} is {string}',
  async ({ upstream }, label: string, profileKey: string) => {
    upstream.setUniformForecast(upstream.findPlaceByLabel(label).id, profileKey);
  },
);

Given(
  'day {int} of the forecast for {string} is {string}',
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

/**
 * Both directions, because the scenario claims the request is *exactly* what
 * the ranking needs. A missing variable is a rule scored on data that never
 * arrived; an extra one is quota spent on a column no rule reads, and it
 * drifts further every time the model is tuned. A subset check would have
 * caught only the first.
 */
Then(
  'the forecast request asked for exactly these daily variables:',
  async ({ upstream }, table: DataTable) => {
    const call = upstream.requestsFor('forecast')[0];
    expectTrue(call !== undefined, 'Expected a forecast call to have been made, but there was none.');

    const requested = (call!.query['daily'] ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v !== '');
    const expected = table.raw().map((row) => row[0]!);

    const missing = expected.filter((v) => !requested.includes(v));
    const unexpected = requested.filter((v) => !expected.includes(v));
    const duplicated = requested.filter((v, i) => requested.indexOf(v) !== i);

    const complaints = [
      missing.length > 0 ? `is missing ${missing.join(', ')} - a rule would be scored on data that never arrived` : '',
      unexpected.length > 0 ? `also asks for ${unexpected.join(', ')} - quota spent on a column no rule reads` : '',
      duplicated.length > 0 ? `repeats ${[...new Set(duplicated)].join(', ')}` : '',
    ].filter(Boolean);

    expectTrue(
      complaints.length === 0,
      `The forecast request ${complaints.join('; and ')}. ` +
        `It asked for: ${requested.join(', ') || '<none>'}`,
    );
  },
);

/**
 * Without a timezone on the request, Open-Meteo answers in GMT and the window
 * starts at GMT midnight - so a user in Auckland gets yesterday on the first
 * card whenever it is already tomorrow there. The bug is invisible from the
 * response alone (seven consecutive dates, all present), which is why it is
 * asserted on the request.
 */
Then("the forecast request asked for dates in the location's timezone", async ({ upstream }) => {
  const call = upstream.requestsFor('forecast')[0];
  expectTrue(call !== undefined, 'Expected a forecast call to have been made, but there was none.');

  const timezone = call!.query['timezone'];
  expectTrue(
    timezone === 'auto' || (timezone !== undefined && timezone.includes('/')),
    `Expected the forecast request to carry a timezone - "auto", or the location's own - got ` +
      `${timezone === undefined ? 'none' : `"${timezone}"`}. Without it Open-Meteo answers in GMT, ` +
      `and day 1 is GMT's today rather than the traveller's.`,
  );
});
