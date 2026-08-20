import { After, AfterAll, Before, BeforeAll, setDefaultTimeout } from '@cucumber/cucumber';
import { config } from './config';
import { fakeOpenMeteo } from './fake-open-meteo';
import { asRankingsResponse, assertRankingInvariants } from './invariants';
import type { ActivityRankingWorld } from './world';

setDefaultTimeout(30_000);

BeforeAll(async function () {
  await fakeOpenMeteo.start(config.fakeUpstreamPort);
  process.stdout.write(
    `\nOpen-Meteo test double listening on ${fakeOpenMeteo.baseUrl}\n` +
      `  Point the API under test at:\n` +
      `    OPEN_METEO_GEOCODING_BASE_URL=${fakeOpenMeteo.geocodingBaseUrl}\n` +
      `    OPEN_METEO_FORECAST_BASE_URL=${fakeOpenMeteo.forecastBaseUrl}\n` +
      `  API under test: ${config.apiBaseUrl}\n\n`,
  );
});

AfterAll(async function () {
  await fakeOpenMeteo.stop();
});

Before(function () {
  fakeOpenMeteo.reset();
});

/**
 * Every ranking the API returns, in any scenario, is held to the structural
 * invariants - even where the feature file was interested in something else.
 * See src/support/invariants.ts for why this is a hook and not just a step.
 */
After(function (this: ActivityRankingWorld, scenario) {
  if (scenario.result?.status !== 'PASSED') return;

  for (const response of [this.response, this.repeatResponse]) {
    if (!response) continue;
    const rankings = asRankingsResponse(response.status, response.body);
    if (rankings) assertRankingInvariants(rankings);
  }
});

/**
 * On failure, attach what the API actually said and what it asked Open-Meteo
 * for. Debugging a ranking disagreement without both halves is guesswork.
 */
After(function (this: ActivityRankingWorld, scenario) {
  if (scenario.result?.status !== 'FAILED') return;

  if (this.response) {
    this.attach(
      JSON.stringify(
        {
          url: this.response.url,
          status: this.response.status,
          durationMs: Math.round(this.response.durationMs),
          headers: Object.fromEntries(this.response.headers.entries()),
          body: this.response.body ?? this.response.rawBody,
        },
        null,
        2,
      ),
      'application/json',
    );
  }

  if (fakeOpenMeteo.requests.length > 0) {
    this.attach(
      JSON.stringify(
        fakeOpenMeteo.requests.map((r) => ({ service: r.service, path: r.path, query: r.query })),
        null,
        2,
      ),
      'application/json',
    );
  }
});
