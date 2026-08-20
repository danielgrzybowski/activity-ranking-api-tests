/**
 * Runs the Open-Meteo double on its own, for anyone building the API against
 * this specification. It serves the standard test cities and a week of mixed
 * weather, so an implementation can be developed without touching the real
 * service or waiting for interesting weather to occur.
 *
 *   npm run stub-upstream
 *
 * Do not run it at the same time as the Cucumber suite - the suite starts its
 * own instance on the same port.
 */

import { config } from '../src/support/config';
import { FakeOpenMeteo } from '../src/support/fake-open-meteo';
import { DEFAULT_PLACES } from '../src/support/fixtures/places';

const WEEK: string[] = [
  'PERFECT_SUMMER_DAY',
  'MILD_OVERCAST_DAY',
  'COLD_RAIN_DAY',
  'STORM_DAY',
  'ALPINE_POWDER_DAY',
  'CLEAN_SWELL_DAY',
  'HEATWAVE_DAY',
];

const fake = new FakeOpenMeteo();
fake.setPlaces(DEFAULT_PLACES);
await fake.start(config.fakeUpstreamPort);

for (const place of DEFAULT_PLACES) {
  WEEK.forEach((profile, index) => fake.setForecastDay(place.id, index + 1, profile));
}

process.stdout.write(
  `Open-Meteo double listening on ${fake.baseUrl}\n\n` +
    `  OPEN_METEO_GEOCODING_BASE_URL=${fake.geocodingBaseUrl}\n` +
    `  OPEN_METEO_FORECAST_BASE_URL=${fake.forecastBaseUrl}\n\n` +
    `Places: ${DEFAULT_PLACES.map((p) => p.name).join(', ')}\n` +
    `Week:   ${WEEK.join(' -> ')}\n\n` +
    `Ctrl-C to stop.\n`,
);

const shutdown = async (): Promise<void> => {
  await fake.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
