# Activity Ranking API — spec-first BDD suite

A Gherkin/TypeScript suite for the **Activity Ranking API**: give it a city, get back seven days
ranked across Skiing, Surfing, Outdoor Sightseeing and Indoor Sightseeing, each with a suitability
and a plain-English reason.

The `.feature` files are executed by **Playwright Test** via
[`playwright-bdd`](https://github.com/vitalets/playwright-bdd), which compiles each scenario into a
Playwright test. Gherkin stays the source of truth; Playwright supplies the runner, the fixtures,
the HTML report and the trace viewer.

The API does not exist yet. This repository is the specification, written as executable Gherkin,
and it is **red on purpose** — 104 scenarios that describe the API someone is about to build.

```
104 failed

  ApiUnreachableError: Could not reach the Activity Ranking API at http://127.0.0.1:3000/health.
    This suite is spec-first: it describes an API that does not exist yet.
    Start the implementation (or point API_BASE_URL at it) to turn these red scenarios green.
```

A red suite is easy to write and worthless if nobody checks the assertions are satisfiable. See
[Proving the red state is a good red state](#proving-the-red-state-is-a-good-red-state) for what I
did about that.

---

## Quick start

```bash
npm install
npm run selfcheck   # 14 checks on the harness itself — green today
npm run validate    # compiles Gherkin to tests; fails on any unwired step
npm test            # 104 scenarios — red today, by design
npm run test:report # opens the Playwright HTML report
```

No browser binaries are needed — this is an API suite and uses Playwright's `APIRequestContext`,
not a page.

`npm run selfcheck` is the one that should always be green. It exercises the Open-Meteo test double
and the contract schemas without touching the API under test, so "is my tooling broken?" and "does
the API exist yet?" never get confused with each other.

| Command | What it does |
| --- | --- |
| `npm test` | The whole suite against `API_BASE_URL` (default `http://127.0.0.1:3000`) |
| `npm run test:smoke` | The handful of `@smoke` scenarios — a build gate |
| `npm run test:contract` | Response shapes, headers, error envelope |
| `npm run test:scoring` | The ranking rules per activity |
| `npm run test:resilience` | Open-Meteo failure modes |
| `npm run test:live` | The `@live` scenarios against the **real** Open-Meteo |
| `npm run validate` | `bddgen` alone — the fast "is the suite well-formed?" check |
| `npm run test:report` | Opens the HTML report from the last run |
| `npm run selfcheck` | Harness self-test — no API required |
| `npm run stub-upstream` | Runs the Open-Meteo double standalone, for building against |
| `npm run typecheck` | `tsc --noEmit` |

Every `test:*` script runs `bddgen` first, which regenerates `.features-gen/` from the `.feature`
files. That directory is build output and is git-ignored — never edit it.

Configuration is via env vars, see `.env.example`. `API_BASE_URL` defaults to `127.0.0.1` rather
than `localhost` on purpose: Playwright resolves `localhost` to `::1` and, unlike `fetch` or `curl`,
does not fall back to IPv4 when nothing is listening there.

---

## The suite

| Feature file | Scenarios | Covers |
| --- | ---: | --- |
| `location-search.feature` | 21 | Partial names, duplicate city names, accents, empty results, input validation, typeahead latency |
| `rankings-contract.feature` | 19 | Response shape, 7 days × 4 activities, rank ordering, tie-break, rating bands, caching, CORS, determinism |
| `location-resolution.feature` | 15 | id vs. city, ambiguity, not-found, conflicting params, hostile input |
| `ranking-sightseeing.feature` | 15 | Outdoor vs. indoor, the indoor floor, heat and storms |
| `ranking-skiing.feature` | 13 | Snow, temperature, wind holds, monotonicity |
| `ranking-surfing.feature` | 11 | The wind sweet spot, storms, cold water |
| `upstream-resilience.feature` | 10 | Open-Meteo 5xx / 429 / timeout / malformed, and what we ask it for |
| `live-open-meteo.feature` | 3 | `@live` — drift check against the real service |

Tags: `@smoke` `@contract` `@scoring` `@resilience` `@performance` `@errors` `@locations`
`@rankings` `@live`. Gherkin tags become Playwright tags, so `npx playwright test --grep @smoke`
works directly. `@live` lives in its own Playwright project and is excluded from `npm test`.

### Two kinds of assertion, deliberately

**Exact**, where the value is a contract: status codes, error codes, field names, rank numbers,
the score→rating bands.

**Ranged or substring**, where pinning the exact value would make the suite a cast of the first
implementation rather than a statement of intent:

- Ratings are asserted as bands (`rated between "FAIR" and "GOOD"`), never as exact scores. Whether
  a powder day scores 91 or 95 is the model's business; that a skier is told `EXCELLENT` is not.
- Reasoning strings are checked for *meaning* — `mentions one of "wind, gust"` — so the copy can be
  rewritten without touching a test.
- Error messages are asserted on `error.code`; the prose is only checked for the fact it must carry
  (e.g. that the minimum query length is stated).

### Invariants checked on every response

Some rules can't be reached by a scenario that names them. The alphabetical tie-break only matters
when two activities happen to score the same, and no weather fixture can force that from the
outside. `src/support/invariants.ts` therefore runs in the teardown of the `api` fixture, against
**every** 200 the suite ever receives from `/v1/rankings` — rank contiguity, score/rank
monotonicity, the tie-break, score↔rating agreement, the reasoning budget, the indoor floor.

### Why the runner is Playwright, and what it does not buy

`playwright-bdd` compiles `features/**/*.feature` into `.features-gen/`, so the Gherkin is still
what runs. What the runner adds over a plain Cucumber setup:

- **Fixtures instead of a World.** Scenario state is a typed `ApiSession` fixture, and the
  Open-Meteo double is a worker-scoped fixture. Setup and teardown are the runner's job, not a
  hook file's, and each step declares exactly what it needs: `async ({ api, upstream }) => …`.
- **Traces and an HTML report.** Every request is recorded; `npm run test:report` shows the failing
  step with the response and the upstream calls attached.
- **`bddgen` as a build-time check.** With `missingSteps: 'fail-on-gen'` and `arityCheck`, an
  unwired or wrong-arity step fails before a single test runs, rather than showing up as a skipped
  scenario in a report nobody reads to the bottom.

What it does **not** buy here is parallelism. The Open-Meteo double is one shared, mutable process
that the API under test reaches on a fixed port, so parallel scenarios would overwrite each other's
weather. `workers: 1` is set in `playwright.config.ts` with that reasoning written next to it. This
is a property of stubbing a separately-deployed service's upstream, not of the runner — the same
constraint applied under Cucumber. At ~4s for 104 scenarios there is nothing to gain anyway.

---

## The API contract I tested against

No contract was given, so I designed one and the suite is written against it. A machine-readable
version is in [`docs/openapi.yaml`](docs/openapi.yaml).

### `GET /health`

`200 {"status":"ok"}`. Used as a precondition so a missing API fails loudly instead of failing
obscurely inside an assertion.

### `GET /v1/locations`

Typeahead. Accepts partial names.

| Param | Required | Notes |
| --- | --- | --- |
| `q` | yes | ≥ 2 characters after trimming |
| `limit` | no | Integer 1–20, default 10 |

```jsonc
// 200
{
  "query": "Lond",                     // echoed, so a typeahead can drop stale responses
  "count": 3,
  "results": [
    {
      "id": "2643743",
      "name": "London",
      "country": "United Kingdom",
      "countryCode": "GB",
      "region": "England",
      "latitude": 51.50853,
      "longitude": -0.12574,
      "timezone": "Europe/London",
      "population": 8961989,
      "displayName": "London, England, United Kingdom"
    }
  ]
}
```

- Ordered by population descending, so the default selection is right for most users.
- **No matches is `200` with an empty list, not `404`.** A typeahead that 404s flashes an error on
  every unfinished word.
- `displayName` is built by the API. Three real Londons exist; a picker showing "London" three
  times is a dead end, and that formatting is not the front end's problem to solve.

### `GET /v1/rankings`

| Param | Required | Notes |
| --- | --- | --- |
| `locationId` | one of | Open-Meteo place id, as returned by `/v1/locations` |
| `city` | one of | Raw name. Exactly one of `locationId` / `city` |
| `days` | no | Integer 1–7, default 7 |

```jsonc
// 200
{
  "location": { /* same shape as a locations result */ },
  "generatedAt": "2026-08-20T09:00:00.000Z",
  "forecast": { "source": "open-meteo", "timezone": "Europe/Paris", "days": 7 },
  "units": { "temperature": "°C", "precipitation": "mm", "snowfall": "cm", "windSpeed": "km/h" },
  "days": [
    {
      "date": "2026-08-20",
      "activities": [
        {
          "activity": "OUTDOOR_SIGHTSEEING",
          "score": 88,
          "rating": "EXCELLENT",
          "rank": 1,
          "reasoning": "Clear skies and 22°C."
        }
        // ... exactly four, one per activity, ranked 1–4
      ]
    }
  ]
}
```

Headers: `Cache-Control: public, max-age=900`, `Content-Type: application/json; charset=utf-8`,
`Access-Control-Allow-Origin`.

### Errors

One envelope, so the front end needs one handler:

```jsonc
{ "error": { "code": "AMBIGUOUS_LOCATION", "message": "...", "details": { "matches": [ /* ... */ ] } } }
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_QUERY` | `q`/`city` too short, bad `limit` |
| 400 | `MISSING_LOCATION` | Neither `locationId` nor `city` |
| 400 | `CONFLICTING_LOCATION_PARAMS` | Both supplied |
| 400 | `INVALID_DAYS` | `days` outside 1–7 |
| 404 | `LOCATION_NOT_FOUND` | Nothing matched |
| 409 | `AMBIGUOUS_LOCATION` | `city` matched several places; `details.matches` carries them |
| 502 | `UPSTREAM_UNAVAILABLE` | Open-Meteo 5xx or unparseable |
| 503 | `UPSTREAM_RATE_LIMITED` | Open-Meteo 429; sets `Retry-After` |
| 504 | `UPSTREAM_TIMEOUT` | Open-Meteo did not answer |

`409` rather than silently picking the largest match: guessing would eventually rank Ontario's
weather for someone standing in England, and the front end can render a picker from
`details.matches` without a second round trip.

### Non-functional

| Budget | Value | Why |
| --- | ---: | --- |
| `/v1/locations` | 500 ms | Fires per keystroke, must feel instant |
| `/v1/rankings` | 2000 ms | The user is watching a spinner — including when Open-Meteo hangs |

---

## The ranking model

`score` is an integer 0–100. `rating` is derived from it and both are returned — the suite asserts
they agree, so a drift between the number driving a progress bar and the label next to it is caught.

| Score | Rating |
| --- | --- |
| 80–100 | `EXCELLENT` |
| 60–79 | `GOOD` |
| 40–59 | `FAIR` |
| 20–39 | `POOR` |
| 0–19 | `UNSUITABLE` |

Ties break alphabetically by activity name, so ranks don't wobble between refreshes.

What the scenarios require of each activity:

- **Skiing** — driven by snowfall, held down by warm air (rain on the piste) and by gusts over
  ~70 km/h, which close lifts however much snow fell. Monotonic in snowfall, all else equal.
- **Surfing** — peaks in the middle of the wind range. Flat calm scores as poorly as a storm, for
  different reasons. Cold air rules it out regardless of wind.
- **Outdoor sightseeing** — mild, dry and still. Penalised by rain, by extreme heat (39 °C is not
  "good weather" for walking a city), by strong wind and by storms.
- **Indoor sightseeing** — has a **floor of 45 (`FAIR`)** and gains as the outdoors loses. This is
  a product decision, not a weather one: the app must never show a day with four dead ends.

Exact coefficients are deliberately *not* specified. The scenarios pin the verdicts and the
orderings; how an implementation gets there is its own business.

---

## Handling the Open-Meteo dependency

An in-process HTTP double (`src/support/fake-open-meteo.ts`) mirrors the real Open-Meteo payloads.
The suite starts it on port 8787 and the API under test is pointed at it:

```bash
OPEN_METEO_GEOCODING_BASE_URL=http://localhost:8787/geocoding
OPEN_METEO_FORECAST_BASE_URL=http://localhost:8787/forecast
```

Substituting at the **HTTP boundary**, not by stubbing a module, is what lets the suite test a
deployed API rather than a process it owns.

This buys three things:

1. **Determinism.** "25cm of powder with light wind" is a fact, not a hope about next Tuesday.
   Ten named weather profiles (`ALPINE_POWDER_DAY`, `BLIZZARD`, `CLEAN_SWELL_DAY`, `STORM_DAY`,
   `HEATWAVE_DAY`, …) are chosen so a human reading the numbers reaches the same verdict the
   Gherkin asks for.
2. **Failure modes.** 500s, 429s, hangs and truncated JSON are one Given away and can't be
   provoked on the real service.
3. **Verifying the request, not just the response.** The double records what was asked, so the
   suite can assert the API requested the right coordinates, `forecast_days=7`, and the daily
   variables the ranking actually needs. A wrong upstream query is an outage nobody notices.

The double reproduces real Open-Meteo quirks, including that a geocoding search with no matches
omits the `results` key entirely rather than returning `[]`.

**Drift risk**, handled: a double can diverge from the real service while every test still passes.
`live-open-meteo.feature` (`@live`) runs against the real Open-Meteo and asserts only what holds
whatever the weather is, so it never flakes. Run it on a schedule, not per commit.

---

## Proving the red state is a good red state

A suite that has never passed is a suite whose assertions have never been checked. Two things I did
about that, neither shipped in this repo:

**1. A throwaway reference implementation.** I built a conforming API in a scratch directory and ran
the suite against it: **104/104 green**. It found two real defects on the first run — a day where
surfing tied with sightseeing and lost the tie-break, and an indoor reasoning string
("Always available, though the weather favours being outside") that named no weather driver and so
told the user nothing. Both were implementation bugs the spec correctly rejected. It is not in the
repo because shipping an implementation would defeat the point of the exercise.

**2. Mutation testing.** I then broke the implementation deliberately, to see whether the suite
notices:

| Mutation | Result |
| --- | --- |
| Rate-limit 429 mapped to a generic 502 | **caught** — 1 scenario |
| `days` range validation removed | **caught** — 4 scenarios |
| Ambiguous city resolved silently instead of 409 | **caught** — 1 scenario |
| `EXCELLENT` band boundary moved 80 → 78 | **caught** — 4 scenarios |
| Indoor floor removed | not caught — *equivalent mutant* |
| Alphabetical tie-break removed | not caught — *see below* |

The indoor-floor mutation is equivalent: that implementation's indoor score never dropped below 48
across a 70-combination probe, so removing a floor at 45 changed nothing observable.

The tie-break mutation is a genuine limit. No weather input can force two activities to the same
score from outside the box, and the probe confirmed zero ties in 70 city/weather combinations.
Naming it in a scenario is not enough, so the rule moved into `invariants.ts` and is now checked
after every 200 in the suite — it fires the moment any implementation produces a tie, rather than
only where a feature file thought to look. I'd rather report this honestly than claim coverage the
suite doesn't have.

---

## Assumptions

1. **The API is deployed and reachable over HTTP.** The suite is black-box; it never imports the
   implementation. `API_BASE_URL` points at it.
2. **Open-Meteo base URLs are configurable via environment variables.** Without that seam, weather
   scenarios can't be deterministic. This is the one demand the suite makes of the implementation's
   internals, and it's a reasonable one.
3. **Open-Meteo's free tier**, default units: °C, mm, cm for snowfall, km/h, `sunshine_duration` in
   seconds. Geocoding via `/v1/search?name=` and `/v1/get?id=`.
4. **`locationId` is the Open-Meteo place id**, surfaced as a string so it stays opaque to clients.
5. **Dates are calendar dates in the location's timezone**, formatted `YYYY-MM-DD`, starting today.
   Scenarios assert against the date the upstream returned rather than against the clock, so the
   suite can't fail at midnight.
6. **No auth, no per-user state.** Nothing in the ticket implies either.
7. **Surfing is scored from wind and air temperature.** See trade-offs.

---

## Omissions and trade-offs

**Marine data for surfing.** Open-Meteo has a Marine API with `wave_height` and `wave_period`,
which is what surfing actually depends on. I scored surfing from wind as a swell proxy instead. It
keeps the contract to two upstream services, avoids the "is this location coastal?" problem
(the Marine API errors for inland coordinates, which every ski scenario would then have to handle),
and the *shape* of the judgement — a middle band, bad at both extremes — is the same. In a real
backlog this is the first follow-up: add `wave_height_max`, keep the scenarios, change the fixtures.

**No auth, rate limiting or pagination scenarios.** Not in the ticket, and inventing a scheme would
have produced tests against a contract nobody asked for.

**Latency budgets are single-request, not percentiles.** A 500 ms typeahead check in a functional
suite catches a gross regression; it is not a load test. p95 under concurrency belongs in k6 or
Gatling, in a pipeline stage of its own.

**Caching is asserted at the header, not the behaviour.** The suite checks `Cache-Control` is sent
with a `max-age`. Whether a second identical request actually skips Open-Meteo is deliberately not
pinned — that's an implementation choice, and `Then Open-Meteo's forecast service was called once`
would forbid a legitimate cache-less design.

**Exact scores are never asserted.** Ranges and orderings only. This is the single biggest
maintainability decision here: a suite that pins `score == 87` has to be rewritten every time the
model is tuned, and would fail for the wrong reason.

**Timezone edge cases are shallow.** The suite asserts the forecast timezone is echoed and dates are
consecutive. A city crossing a DST boundary mid-forecast is a real case I'd add next; I'd need a
decision on whether "today" means the user's timezone or the destination's before writing it.

**The suite is not a CI gate yet.** Until an implementation exists, CI runs the typecheck, the
harness self-check and `bddgen`, which fails on any undefined or wrong-arity step. The suite itself
runs in a non-blocking step so the intended red is visible without breaking the build. Flipping it
to blocking is a one-line change once the API lands.

**Retries are off.** Playwright's default instinct is to retry a flaky test; a spec suite that is
red by design would just take three times as long to say so. Once the API exists and the suite is a
gate, `retries: 1` on CI would be reasonable — the `@live` project especially.

---

## Project layout

```
playwright.config.ts          runner config; two BDD projects (spec, live)
features/
  *.feature                   the specification
  step_definitions/           thin glue: request, assert, nothing clever
src/support/
  fixtures.ts                 the ApiSession fixture, the upstream fixture, Given/When/Then
  domain.ts                   activities, rating bands, budgets — the vocabulary
  schemas.ts                  zod contract schemas (strict: extra fields are a contract change)
  invariants.ts               rules held against every 200, not just where named
  fake-open-meteo.ts          the upstream test double
  api-client.ts               request wrapper with timing and a legible unreachable error
  assertions.ts               assertions whose failure messages name the reason
  fixtures/                   weather profiles and places
scripts/
  selfcheck.ts                proves the harness works without the API
  stub-upstream.ts            runs the double standalone
docs/openapi.yaml             the contract, machine-readable
.features-gen/                build output from bddgen — git-ignored, never edited
```

Everything under `src/support` except `fixtures.ts` and `api-client.ts` is runner-agnostic — no
import from Playwright or Cucumber. That was not an accident: this suite was first written on
Cucumber and moved to Playwright, and the move touched the config, the fixtures and the step
signatures. The domain vocabulary, the schemas, the invariants, the assertions and the weather
fixtures were untouched, and the `.feature` files did not change by a single character.

Step definitions stay thin on purpose: a step reads the Gherkin, makes one call or one assertion,
and delegates anything shared to `src/support`. Logic that drifts into step definitions is logic
nobody reviews.

---

## On AI use

I used Claude throughout, the way I'd use it on a normal ticket: drafting the first pass of the
weather fixtures and the Open-Meteo payload shapes, generating the repetitive step definitions, and
as a reviewer on the Gherkin — asking it to argue the opposite verdict for a given weather profile
was a good way to find scenarios that were assertions of taste rather than of behaviour.

The judgement calls it did not make for me: the 409-on-ambiguity decision, the indoor floor, scoring
by band rather than by exact value, and the decision to validate the suite with a throwaway
implementation and a mutation run. The two defects that run surfaced are the argument for doing it —
both scenarios looked completely reasonable on the page.
