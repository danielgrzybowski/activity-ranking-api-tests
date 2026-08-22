# Activity Ranking API — spec-first BDD suite

A Gherkin/TypeScript specification for the **Activity Ranking API**: search for a place by name,
pick one of the matches, get seven days ranked across Skiing, Surfing, Outdoor Sightseeing and
Indoor Sightseeing, each with a suitability and a plain-English reason.

The API does not exist yet. `npm test` is **red on purpose** — 58 scenarios (87 with `Scenario
Outline` examples expanded) describing the API someone is about to build.

```bash
npm install
npm test              # the specification — red today, by design
npm run demo:green    # the same scenarios against reference-impl/ — green
npm run mutation-run  # 10 deliberate defects, all 10 caught
npm run demo:live     # the 3 @live scenarios, reference impl vs. the real Open-Meteo
```

`npm test` and `npm run test:live` point at `API_BASE_URL` and start nothing, so both are red until
an API is listening there — `test:live` additionally needs that API configured against the **real**
Open-Meteo, since it is a drift check on the double. `demo:green` and `demo:live` are the same two
runs with the reference implementation started for you.

`reference-impl/` is a throwaway implementation of the contract, not the deliverable: it exists so
the specification can be *proved* satisfiable and so the mutation run has something to break.
`npm run selfcheck` exercises the harness with no API at all, so "my tooling is broken" and "the API
doesn't exist yet" never get confused. Config is env vars — see `.env.example`.

The `.feature` files run under Playwright Test via
[`playwright-bdd`](https://github.com/vitalets/playwright-bdd), so Gherkin is what executes; the
runner adds typed fixtures, traces, and `bddgen` as a build-time check that every step is wired.

---

## Approach

**Coverage is not the point.** With an AI to hand, three hundred scenarios is an afternoon; the
useful work is deciding which cases matter, and saying out loud which ones I skipped and why. The
omissions at the bottom of this file are as much a part of the submission as the scenarios.

**Where each acceptance criterion lives:**

| Criterion | Scenarios |
| --- | --- |
| Accepts a city or town name | `location-resolution.feature` — resolves when unambiguous, asks when not |
| Accepts a partial name, returns matches | `location-search.feature` — ordering, accents, catalogue gaps, validation |
| Fetches 7 days from Open-Meteo | `upstream-resilience.feature` — what we ask for, and every way it can fail |
| Ranks each day for each activity | `ranking-{skiing,surfing,sightseeing}.feature`, plus ranks and tie-break in `rankings-contract.feature` |
| Per day/activity: date, activity, suitability, reasoning | `rankings-contract.feature` |

**Assertions are exact where the value is a contract** — status codes, error codes, field names,
rank numbers, score→rating bands — **and ranged or substring where it is not**. Ratings are asserted
as bands (`rated between "FAIR" and "GOOD"`), reasoning by meaning (`mentions one of "wind, gust"`),
errors by `error.code` rather than prose. A suite that pins `score == 87` gets rewritten every time
the model is tuned and fails for the wrong reason.

**One driver at a time.** Where a scenario claims a single factor decides the verdict, the fixtures
differ in that factor alone: `ALPINE_POWDER_DAY` / `LIGHT_SNOW_DAY` / `COLD_DRY_DAY` vary snowfall at
constant temperature and wind. The location counts as a variable too — the same `CLEAN_SWELL_DAY` is
`EXCELLENT` at Bude and `UNSUITABLE` at Chamonix.

**Some rules can't be reached by a scenario that names them** — the alphabetical tie-break only
matters when two activities happen to tie. `src/support/invariants.ts` runs against every 200 the
suite receives: rank contiguity, score↔rating agreement, the reasoning budget, that every reasoning
names a weather driver or says why the place rules the activity out, the indoor floor, and that
geography rules an activity out for the whole week or not at all.

**How I know the red state is a good one.** `demo:green` runs all 87 scenarios against
`reference-impl/` and they pass. `mutation-run` then breaks that implementation ten ways — a 429
reported as a 502, ambiguity resolved silently, the tie-break reversed, and seven more — and counts
the scenarios that notice. All ten are caught.

The indoor-floor mutant took two attempts, and the first is the more useful story. Deleting the
`Math.max` changed no output at all: that implementation's indoor score is `88 - outdoor × 0.45` and
cannot fall below 43, so a floor at 40 was unreachable. That mutant measured nothing about the suite
— the floor invariant was there and correct throughout — so it was replaced with the model an
implementation *without* a floor actually writes, indoor as a plain mirror of the outdoors, which
reaches 0 on a clear summer afternoon. A 10/10 that comes from fixing the mutation is worth stating;
one that comes from tuning the assertions would not be.

`echo_origin_without_vary` is in the set for a different reason. The `Vary: Origin` check is vacuous
against an implementation that answers `*`, which this one does, so without a mutant that echoes the
caller's origin there would be no run in which that assertion is known to fire at all.

---

## What the front end drove

The brief asks for an API and then says it has to be fit for a front end. These are in the contract
for that reason alone — each is a screen that would otherwise be broken:

| Decision | The problem it solves |
| --- | --- |
| No matches is `200` with an empty list, never `404` | A typeahead that 404s flashes an error at a user who is still typing |
| The `query` is echoed back | Keystroke responses arrive out of order; the echo is what lets a client drop a stale one |
| `displayName` built by the API, unique within a response | Three Londons in three countries, and four *pairs* sharing a US state. Colliding labels reach for the county; the rest stay short |
| Only settlements, never airfields | Open-Meteo files heliports under the village's name — unfiltered, "Zermatt" comes back twice with identical labels |
| Unknown population sorts last, never dropped | The default selection stays right without making a real town unreachable |
| `409` carrying `details.matches` | The picker renders from the error body, no second round trip |
| `feasible` as a field, not inferred from prose | "Sea breeze, 19°C" is a good day at the beach, not a statement that there is no sea |
| Indoor sightseeing floored at `FAIR` | No day can show four dead ends |
| One error envelope, stated latency budgets | One handler instead of nine; 500 ms so the typeahead feels instant, 2000 ms so the spinner stays plausible |
| `Vary: Origin` wherever the CORS header names one origin | `Cache-Control: public` and a per-caller header on one response is a CDN handing the first origin's permission to the next, and a browser blocking a response it was entitled to |

---

## The API contract

No contract was given, so I designed one. **The zod schemas in `src/support/schemas.ts` are the
authoritative version** — `strict`, so an undocumented field is a contract change and the suite says
so. Below is what a schema cannot carry.

`GET /health` → `200 {"status":"ok"}`, so a missing API fails loudly rather than inside an assertion.

### `GET /v1/locations?q=&limit=`

`q` required, ≥ 2 characters after trimming; `limit` an integer 1–20, default 10.

```jsonc
// 200 — population descending, unknown population last, no matches is an empty list
{ "query": "Lond", "count": 3, "results": [ /* Location */ ] }
```

A `Location` carries `id`, `name`, `country`, `countryCode`, `region`, `latitude`, `longitude`,
`timezone`, `population`, `displayName`. `region` and `population` are nullable — Open-Meteo has
neither for plenty of real places — and `displayName` drops the parts that do not exist
(`"Nazaré, Portugal"`, never `"Nazaré, , Portugal"`). `limit` counts towns, not rows the upstream
sent: filtering runs after Open-Meteo's cap, so the API over-fetches and trims.

### `GET /v1/rankings?locationId=|city=&days=`

Exactly one of `locationId` / `city`. `days` 1–7, default 7, passed through as `forecast_days`
rather than trimmed afterwards.

```jsonc
// 200
{
  "location": { /* Location */ },
  "generatedAt": "2026-08-20T09:00:00.000Z",
  "forecast": { "source": "open-meteo", "timezone": "Europe/Paris", "days": 7 },
  "units": { "temperature": "°C", "precipitation": "mm", "snowfall": "cm", "windSpeed": "km/h" },
  "days": [{
    "date": "2026-08-20",
    "activities": [   // exactly four, ranked 1–4, ties broken alphabetically
      { "activity": "OUTDOOR_SIGHTSEEING", "feasible": true, "score": 88,
        "rating": "EXCELLENT", "rank": 1, "reasoning": "Clear skies and 22°C." },
      { "activity": "SURFING", "feasible": false, "score": 0,
        "rating": "UNSUITABLE", "rank": 4, "reasoning": "No coast within reach." }
    ]
  }]
}
```

`score` is 0–100 and `rating` is derived from it in fixed bands (80/60/40/20), both returned so a
drift between the progress bar and the label beside it is catchable. Dates are calendar dates in the
location's timezone, starting today. Headers: `Cache-Control: public, max-age=900`,
`Content-Type: application/json; charset=utf-8`, and `Access-Control-Allow-Origin` — either `*` or
the caller's own origin, and where it is the latter, `Vary: Origin` alongside it.

### Errors

One envelope: `{ "error": { "code": …, "message": …, "details": … } }`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_QUERY` | `q`/`city` too short, bad `limit`, or a parameter supplied twice |
| 400 | `MISSING_LOCATION` / `CONFLICTING_LOCATION_PARAMS` | Neither, or both, of `locationId` and `city` |
| 400 | `INVALID_DAYS` | `days` outside 1–7 |
| 404 | `LOCATION_NOT_FOUND` | Nothing matched |
| 409 | `AMBIGUOUS_LOCATION` | Several places matched; `details.matches` carries them |
| 502 / 503 / 504 | `UPSTREAM_UNAVAILABLE` / `UPSTREAM_RATE_LIMITED` / `UPSTREAM_TIMEOUT` | Open-Meteo broke, rate-limited us (sets `Retry-After`), or did not answer |

`409` rather than picking the largest match: guessing eventually ranks Ontario's weather for someone
standing in England. A parameter supplied twice is a `400` rather than a first-wins guess — the
caller is confused about its own request, and choosing for it hides their bug.

### The ranking model

Two questions, in that order: **can this be done here at all**, and **does the weather suit it**.
Surfing needs a coast, skiing needs a ski area; where the place cannot support the activity it is
`feasible: false`, `UNSUITABLE` at 0 every day, with a reasoning that says why. Skipping that first
question is not a rounding error — wind blows everywhere, so a weather-only model reports
`SURFING: FAIR` for an alpine valley. Sightseeing is never ruled out this way.

After that: skiing is driven by snowfall and held down by warm air and lift-closing gusts; surfing
peaks in the middle of the wind range and is ruled out by cold; outdoor sightseeing wants mild, dry
and still; indoor sightseeing gains as the outdoors loses and has a floor at the bottom of the `FAIR`
band, so the app can never show a day with four dead ends. Exact coefficients are deliberately
unspecified — the scenarios pin verdicts and orderings.

---

## Handling the Open-Meteo dependency

An in-process HTTP double (`src/support/fake-open-meteo.ts`) mirrors the real payloads. The suite
starts it on port 8787 and the API under test is pointed at it — at `127.0.0.1` and not `localhost`,
because the double binds the IPv4 loopback and a client that resolves `localhost` to `::1` finds
nothing listening:

```bash
OPEN_METEO_GEOCODING_BASE_URL=http://127.0.0.1:8787/geocoding
OPEN_METEO_FORECAST_BASE_URL=http://127.0.0.1:8787/forecast
```

Substituting at the **HTTP boundary** rather than stubbing a module is what lets the suite test a
deployed API rather than a process it owns. It buys determinism ("25cm of powder" is a fact, not a
hope about next Tuesday), failure modes that cannot be provoked on the real service, and the ability
to assert the *request* — right coordinates, right `forecast_days`, a timezone, and exactly the daily
variables the ranking reads. A wrong upstream query is an outage nobody notices.

The double reproduces real quirks: no matches omits `results` entirely rather than returning `[]`,
and a place with no region or population omits those keys rather than sending `null`.

**Quota:** the whole spec suite costs zero upstream calls, however many scenarios it grows to.
`demo:green` and `mutation-run` also run entirely against the double. Only `@live` touches the real
service — one run is five calls, measured — and it is a separate Playwright project, excluded from
`npm test` and from CI. It asserts the contract and nothing about the catalogue, so a renamed region
does not turn it red.

---

## Assumptions

1. **The API is deployed and reachable over HTTP.** The suite is black-box and never imports it.
2. **Open-Meteo base URLs are configurable via environment variables.** Without that seam the
   weather scenarios cannot be deterministic. It is the only demand made of the implementation's
   internals.
3. **Open-Meteo's free tier**, default units, geocoding via `/v1/search` and `/v1/get`, and a
   `feature_code` on results where `PPL*` means a populated place.
4. **`locationId` is the Open-Meteo place id**, surfaced as a string so it stays opaque. Ids and
   coordinates in the fixtures are real; the weather is constructed.
5. **Dates start today in the location's timezone.** Scenarios assert against the date the upstream
   returned rather than a clock, so the suite cannot fail at midnight.
6. **The API can tell whether a place has a surfable coast and a reachable ski area.** The suite
   asserts the behaviour and says nothing about where the answer comes from.
7. **The typeahead client debounces.** The 500 ms budget and the upstream quota both assume it; the
   API cannot enforce it and does not rate limit, so a client that hammers burns the quota and
   surfaces it as `503` — which reads like the provider's fault. Worth a rate limit before shipping.
8. **No auth, no per-user state.** Nothing in the ticket implies either.

---

## Omissions and trade-offs

Deliberately not covered, in rough order of how much I'd want them next:

**Exhaustive input permutations.** Each rejection rule is exercised once per code path it can take,
not once per way of tripping it: `limit` is tested at `0` and `many` — the range check and the parse
check — and not also at `21` and `-1`, which re-enter the same branch. Injection-shaped input is
four rows (percent-encoded script and SQL, a path traversal, a raw NUL), not one per attack family;
the property being pinned is "never a 500", and a fifth flavour of quoting does not test it harder. The
per-activity verdict tables carry one row per distinct verdict rather than one per weather profile —
three ways of saying "no snow, too warm" was padding. Generating the full cross-product is an
afternoon with an AI and would have made the suite longer without making it say more.

**Marine data for surfing.** `wave_height` is what surfing actually depends on; I used wind as a
swell proxy to keep the contract to two upstream services. The *shape* of the judgement — a middle
band, bad at both extremes — is the same. First follow-up, and it pays twice: wave height for the
scoring, and the Marine API's rejection of inland coordinates for the feasibility check.

**Nulls inside `daily` arrays.** Open-Meteo really does return them (1 in 16 for
`precipitation_probability_max` when I checked) and the double never does, so nothing says what the
API should do with a hole in the forecast. Reading it as zero would mean inventing weather.

**The feasibility data is stubbed.** `reference-impl/terrain.ts` is a hand-written list of coastline
and ski-area points sized to the places the suite exercises — enough to prove the rule implementable,
nowhere near enough to ship. The thresholds (25 km to a beach, 50 km to a ski area) are a product
decision I made rather than found.

**Timezones are shallow.** The request is asserted to carry a timezone and the response to echo the
location's — verified live, where Auckland's day 1 is its own date rather than GMT's. Not asserted:
that day 1 *is* today, because the double dates forecasts from UTC. A city crossing DST mid-forecast
is untested.

**Character validation on place names: none, on purpose.** `100 Mile House`, `N'Djamena` and
`'s-Hertogenbosch` are real. The safety property is "never 500", tested with injection-shaped input,
not "reject unusual characters". What is missing is the positive half — nothing proves a name with an
apostrophe still works, so an implementation that "sanitises" input would pass.

**Caching is asserted at the header, not the behaviour.** Whether a second identical request skips
Open-Meteo is an implementation choice; pinning it would forbid a legitimate cache-less design.

**Latency budgets are single-request, not percentiles.** A 500 ms check catches a gross regression;
p95 under load belongs in k6, in a stage of its own.

**No auth, rate limiting or pagination scenarios.** Not in the ticket, and inventing a scheme would
test a contract nobody asked for.

**Not a CI gate yet.** CI runs typecheck, selfcheck, `bddgen` and `demo:green` as blocking steps, and
the spec suite non-blocking so the intended red stays visible. One line to flip once the API lands.

---

## Layout

```
features/            the specification, plus thin step definitions
src/support/         domain vocabulary, zod schemas, invariants, the Open-Meteo double, fixtures
reference-impl/      a conforming API, used only to prove the suite satisfiable and its assertions
                     load-bearing; mutations.ts holds the deliberate defects
scripts/             demo-green, mutation-run, selfcheck, stub-upstream
```

`src/support` is runner-agnostic apart from `fixtures.ts` and `api-client.ts`: moving from Cucumber
to Playwright changed the config and the step signatures, not a character of Gherkin.

---

## On AI use

I used Claude throughout: drafting weather fixtures and payload shapes, generating repetitive step
definitions, and arguing the opposite verdict for a profile to find scenarios that were assertions of
taste rather than behaviour.

Two things caught defects mechanically — the reference implementation found two scenarios passing for
the wrong reason, and `@live` found a `displayName` rule that did not survive four pairs of Londons
sharing a US state. **Most of the rest came from interrogating the output rather than running it.**
AI produces work that is plausible, internally consistent and green against its own tests, and that
is the failure mode to watch: surfing rated `FAIR` for a landlocked valley, four of nine fixture ids
wrong against the real service, a double whose metadata was invented rather than verified, a comment
explaining a scenario with a cause that turned out to be fiction. All of it passed every check here
at the time. The habit is worth more than the fixes: ask where a value came from, then check it
against the real thing.

Judgement calls it did not make for me: 409-on-ambiguity, the indoor floor pinned to a band boundary,
scoring by band rather than exact value, geography before weather, and validating the suite with a
throwaway implementation at all.
