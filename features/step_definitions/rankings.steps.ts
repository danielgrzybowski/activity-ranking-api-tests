import type { DataTable } from 'playwright-bdd';
import { expectEqual, expectMentionsAny, expectTrue, parseWith } from '../../src/support/assertions';
import {
  ACTIVITIES,
  INFEASIBILITY_MARKERS,
  RATINGS,
  RATING_BANDS,
  expectedRankOrder,
  explainsInfeasibility,
  explainsVerdict,
  isAtLeast,
  ratingForScore,
  sharedReasonings,
  type Activity,
  type Rating,
} from '../../src/support/domain';
import { Then, When } from '../../src/support/fixtures';
import {
  AmbiguousLocationDetailsSchema,
  RankingsResponseSchema,
  type ActivityRanking,
  type DayRanking,
  type RankingsResponse,
} from '../../src/support/schemas';

const RANKINGS_PATH = '/v1/rankings';

function assertActivity(name: string): Activity {
  if (!(ACTIVITIES as readonly string[]).includes(name)) {
    throw new Error(`Unknown activity "${name}". Known activities: ${ACTIVITIES.join(', ')}`);
  }
  return name as Activity;
}

function assertRating(name: string): Rating {
  if (!(RATINGS as readonly string[]).includes(name)) {
    throw new Error(`Unknown rating "${name}". Known ratings: ${RATINGS.join(', ')}`);
  }
  return name as Rating;
}

function day(rankings: RankingsResponse, dayNumber: number): DayRanking {
  const entry = rankings.days[dayNumber - 1];
  if (!entry) {
    throw new Error(
      `The response has only ${rankings.days.length} day(s), so there is no day ${dayNumber}.`,
    );
  }
  return entry;
}

function entryFor(dayRanking: DayRanking, activity: Activity): ActivityRanking {
  const entry = dayRanking.activities.find((a) => a.activity === activity);
  if (!entry) {
    throw new Error(
      `Day ${dayRanking.date} has no entry for ${activity}. Present: ` +
        `${dayRanking.activities.map((a) => a.activity).join(', ')}`,
    );
  }
  return entry;
}

function describeDay(dayRanking: DayRanking): string {
  return dayRanking.activities
    .map((a) => `${a.activity}=${a.score}/${a.rating}(rank ${a.rank})`)
    .join(', ');
}

// --- requests ---------------------------------------------------------------

When('I request rankings for location id {string}', async ({ api }, locationId: string) => {
  await api.call({ path: RANKINGS_PATH, query: { locationId } });
});

When('I request rankings for location id {string} again', async ({ api }, locationId: string) => {
  await api.callAgain({ path: RANKINGS_PATH, query: { locationId } });
});

When(
  'I request rankings for location id {string} over {int} days',
  async ({ api }, locationId: string, days: number) => {
    await api.call({ path: RANKINGS_PATH, query: { locationId, days } });
  },
);

// Quoted day counts are the invalid ones: "0", "8", "week".
When(
  'I request rankings for location id {string} over {string} days',
  async ({ api }, locationId: string, days: string) => {
    await api.call({ path: RANKINGS_PATH, query: { locationId, days } });
  },
);

When('I request rankings for the city {string}', async ({ api }, city: string) => {
  await api.call({ path: RANKINGS_PATH, query: { city } });
});

When('I request rankings with no location', async ({ api }) => {
  await api.call({ path: RANKINGS_PATH });
});

/**
 * The seam between the two endpoints, and the only step that reads one
 * response to build the next request. Whatever the search called the place,
 * the ranking has to accept the id it handed out.
 */
When('I request rankings for the first search result', async ({ api }) => {
  const results = api.locations().results;
  const first = results[0];
  if (!first) throw new Error('The search returned no results, so there is no id to rank.');
  await api.call({ path: RANKINGS_PATH, query: { locationId: first.id } });
});

/** Sent verbatim, so bytes an encoder would have scrubbed reach the API. */
When('I request rankings with the raw query string {string}', async ({ api }, rawQuery: string) => {
  await api.call({ path: RANKINGS_PATH, rawQuery });
});

When(
  'I request rankings for location id {string} and the city {string}',
  async ({ api }, locationId: string, city: string) => {
    await api.call({ path: RANKINGS_PATH, query: { locationId, city } });
  },
);

// --- contract-level assertions ---------------------------------------------

Then('the response matches the rankings contract', async ({ api }) => {
  parseWith(RankingsResponseSchema, api.lastResponse.body, 'The rankings response');
});

Then(
  'the ranking covers {int} consecutive days starting from the first forecast day',
  async ({ api, upstream }, expectedCount: number) => {
    const days = api.rankings().days;
    expectTrue(
      days.length === expectedCount,
      `Expected ${expectedCount} day(s) of rankings, got ${days.length}.`,
    );

    const start = new Date(`${upstream.firstForecastDate}T00:00:00Z`);
    const expected = Array.from({ length: expectedCount }, (_, i) =>
      new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    );
    const actual = days.map((d) => d.date);

    expectTrue(
      JSON.stringify(actual) === JSON.stringify(expected),
      `Expected consecutive dates [${expected.join(', ')}], got [${actual.join(', ')}]`,
    );
  },
);

Then('every day ranks all four activities:', async ({ api }, table: DataTable) => {
  const expected = table.raw().map((row) => assertActivity(row[0]!));
  for (const dayRanking of api.rankings().days) {
    const present = dayRanking.activities.map((a) => a.activity);
    const missing = expected.filter((a) => !present.includes(a));
    expectTrue(
      missing.length === 0,
      `Day ${dayRanking.date} is missing ${missing.join(', ')}. A day with a gap breaks the grid the UI renders.`,
    );
    expectTrue(
      new Set(present).size === present.length,
      `Day ${dayRanking.date} lists an activity more than once: ${present.join(', ')}`,
    );
  }
});

/**
 * The ticket's own list, in one place: "the response includes, per day and per
 * activity: Date, Activity name, A measure of how suitable the conditions are,
 * Reasoning". The schema enforces the types; this says out loud that the four
 * things the feature was asked for are the four things that arrive.
 */
Then('every entry carries a date, an activity name, a suitability and a reason', async ({ api }) => {
  for (const dayRanking of api.rankings().days) {
    expectTrue(
      /^\d{4}-\d{2}-\d{2}$/.test(dayRanking.date),
      `Expected an ISO calendar date on each day, got "${dayRanking.date}".`,
    );
    for (const entry of dayRanking.activities) {
      const where = `${entry.activity} on ${dayRanking.date}`;
      expectTrue(
        (ACTIVITIES as readonly string[]).includes(entry.activity),
        `${where} names an activity outside the four in the ticket.`,
      );
      // Both halves of the suitability: the number a progress bar renders, and
      // the label beside it. Either alone leaves the front end guessing.
      expectTrue(
        Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 100,
        `${where} has score ${entry.score}, outside the documented 0-100 range.`,
      );
      expectTrue(
        entry.rating === ratingForScore(entry.score),
        `${where} scores ${entry.score} but is labelled "${entry.rating}".`,
      );
      expectTrue(
        entry.reasoning.trim().length > 0,
        `${where} has no reasoning, so the user is told a verdict with no reason for it.`,
      );
    }
  }
});

/**
 * The number comes from the Gherkin, so the scenario reads as the product
 * decision it is. It is not cross-checked against REASONING_MAX_LENGTH here:
 * that would make the parameter a fiction, and fail a scenario with a
 * complaint about the suite's own constant rather than about the API.
 * Nothing is lost - invariants.ts holds the documented budget against every
 * 200 the suite receives, whether or not a feature file mentions it.
 */
Then('every reasoning is at most {int} characters', async ({ api }, limit: number) => {
  for (const dayRanking of api.rankings().days) {
    for (const entry of dayRanking.activities) {
      expectTrue(
        entry.reasoning.length <= limit,
        `${entry.activity} on ${dayRanking.date} has a ${entry.reasoning.length}-character reasoning, ` +
          `over the ${limit}-character budget for a card: "${entry.reasoning}"`,
      );
    }
  }
});

/**
 * "Suitable" on its own tells the user nothing, and leaves them unable to tell
 * a bad week from a bad idea. The rule itself lives in `explainsVerdict`,
 * because invariants.ts holds it against every 200 the suite receives and the
 * two must not be able to drift apart.
 */
Then('every reasoning gives a reason the user can act on', async ({ api }) => {
  for (const dayRanking of api.rankings().days) {
    for (const entry of dayRanking.activities) {
      expectTrue(
        explainsVerdict(entry.reasoning, entry.feasible),
        `${entry.activity} on ${dayRanking.date} gives no reason a user could act on: ` +
          `"${entry.reasoning}"`,
      );
    }
  }
});

/**
 * The rule lives in `sharedReasonings` for the same reason `explainsVerdict`
 * does: invariants.ts holds it against every 200 the suite receives, and a
 * second copy here could drift away from the one that runs everywhere.
 */
Then('no two activities on a day share the same reasoning', async ({ api }) => {
  for (const dayRanking of api.rankings().days) {
    for (const shared of sharedReasonings(dayRanking.activities)) {
      expectTrue(
        false,
        `On ${dayRanking.date}, ${shared.activities.join(' and ')} carry the same sentence: ` +
          `"${shared.reasoning}". The user is told what the weather is doing, not why one ` +
          `activity beat another.`,
      );
    }
  }
});

/**
 * Whether a place has a coast or a ski area is a property of the place, so
 * this is asserted across the whole forecast rather than on a single day: the
 * verdict, the score and the explanation all have to hold every day.
 */
Then('{string} is reported as not possible at this location', async ({ api }, activityName: string) => {
  const activity = assertActivity(activityName);
  for (const dayRanking of api.rankings().days) {
    const entry = entryFor(dayRanking, activity);
    expectTrue(
      !entry.feasible,
      `${activity} on ${dayRanking.date} is marked feasible and scored on the weather ` +
        `("${entry.reasoning}"), but this location cannot support it at all.`,
    );
    expectTrue(
      entry.score === 0 && entry.rating === 'UNSUITABLE',
      `${activity} on ${dayRanking.date} says it is not possible here ("${entry.reasoning}") but ` +
        `scores ${entry.score}/${entry.rating}. Something a user cannot do is UNSUITABLE at 0.`,
    );
    expectTrue(
      explainsInfeasibility(entry.reasoning),
      `${activity} on ${dayRanking.date} is not possible here, but the reasoning does not say so: ` +
        `"${entry.reasoning}". It has to name the reason - one of [${INFEASIBILITY_MARKERS.join(', ')}] - ` +
        `or the user reads a bad idea as a bad week.`,
    );
  }
});

Then(
  '{string} is scored on the weather, not ruled out by the location',
  async ({ api }, activityName: string) => {
    const activity = assertActivity(activityName);
    for (const dayRanking of api.rankings().days) {
      const entry = entryFor(dayRanking, activity);
      expectTrue(
        entry.feasible,
        `${activity} on ${dayRanking.date} was ruled out by the location ("${entry.reasoning}"), but ` +
          `this place supports it. The verdict has to come from the forecast.`,
      );
    }
  },
);

Then('every day numbers its activities 1 to 4 with no gaps or duplicates', async ({ api }) => {
  for (const dayRanking of api.rankings().days) {
    const ranks = dayRanking.activities.map((a) => a.rank).sort((a, b) => a - b);
    const expected = Array.from({ length: dayRanking.activities.length }, (_, i) => i + 1);
    expectTrue(
      JSON.stringify(ranks) === JSON.stringify(expected),
      `Day ${dayRanking.date} has ranks [${ranks.join(', ')}], expected [${expected.join(', ')}]. ` +
        describeDay(dayRanking),
    );
  }
});

Then('within each day a better score never has a worse rank', async ({ api }) => {
  for (const dayRanking of api.rankings().days) {
    for (const a of dayRanking.activities) {
      for (const b of dayRanking.activities) {
        if (a.score > b.score) {
          expectTrue(
            a.rank < b.rank,
            `On ${dayRanking.date} ${a.activity} scores ${a.score} but ranks ${a.rank}, ` +
              `below ${b.activity} which scores ${b.score} at rank ${b.rank}.`,
          );
        }
      }
    }
  }
});

Then('activities tied on score are ordered alphabetically', async ({ api }) => {
  for (const dayRanking of api.rankings().days) {
    const expected = expectedRankOrder(dayRanking.activities);
    const actual = [...dayRanking.activities].sort((a, b) => a.rank - b.rank).map((a) => a.activity);
    expectTrue(
      JSON.stringify(actual) === JSON.stringify(expected),
      `On ${dayRanking.date} the documented tie-break (score desc, then activity name) gives ` +
        `[${expected.join(', ')}], but the API returned [${actual.join(', ')}]. ${describeDay(dayRanking)}`,
    );
  }
});

Then('every rating matches the documented band for its score', async ({ api }) => {
  const bands = RATING_BANDS.map((b) => `${b.rating} ${b.min}-${b.max}`).join(', ');
  for (const dayRanking of api.rankings().days) {
    for (const entry of dayRanking.activities) {
      const expected = ratingForScore(entry.score);
      expectTrue(
        entry.rating === expected,
        `${entry.activity} on ${dayRanking.date} scores ${entry.score} and is labelled "${entry.rating}", ` +
          `but the documented bands make that "${expected}". Bands: ${bands}`,
      );
    }
  }
});

Then('the resolved location is {string}', async ({ api }, displayName: string) => {
  expectEqual(api.rankings().location.displayName, displayName, 'the resolved location');
});

Then('the resolved location id is {string}', async ({ api }, id: string) => {
  expectEqual(api.rankings().location.id, id, 'the resolved location id');
});

Then(
  'the response declares units for temperature, precipitation, snowfall and wind speed',
  async ({ api }) => {
    const units = api.rankings().units;
    for (const [key, value] of Object.entries(units)) {
      expectTrue(
        typeof value === 'string' && value.length > 0,
        `The response declares no unit for ${key}, so the numbers in the reasoning are ambiguous.`,
      );
    }
  },
);

Then('the forecast source is {string}', async ({ api }, source: string) => {
  expectEqual(api.rankings().forecast.source, source, 'the forecast source');
});

Then('the forecast timezone is {string}', async ({ api }, timezone: string) => {
  expectEqual(api.rankings().forecast.timezone, timezone, 'the forecast timezone');
});

Then('both responses are identical apart from the generation timestamp', async ({ api }) => {
  const second = api.repeatResponse;
  expectTrue(second !== undefined, 'The scenario did not make a second request.');

  /**
   * Keys are sorted before comparing, so a serialiser that emits them in a
   * different order twice is not reported as a non-deterministic *ranking*.
   * The claim under test is about values; a misdiagnosis here would send
   * somebody hunting through the scoring model for a bug in a JSON writer.
   */
  const strip = (body: unknown): string => {
    const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    delete clone['generatedAt'];
    const sortKeys = (_key: string, value: unknown): unknown =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : value;
    return JSON.stringify(clone, sortKeys);
  };

  expectTrue(
    strip(api.lastResponse.body) === strip(second!.body),
    'The same forecast produced two different rankings. Nothing downstream - caching, ' +
      'sharing a link, comparing two tabs - can be trusted if the ranking is not deterministic.',
  );
});

// --- scoring assertions -----------------------------------------------------

/**
 * The three rating phrasings share one check. They stay three steps because
 * they read differently at the point of use, and a scenario that means "no
 * worse than FAIR" should not have to say "between FAIR and EXCELLENT".
 */
function expectRatingWithin(
  rankings: RankingsResponse,
  dayNumber: number,
  activityName: string,
  lowestName: string,
  highestName: string,
): void {
  const activity = assertActivity(activityName);
  const lowest = assertRating(lowestName);
  const highest = assertRating(highestName);
  const dayRanking = day(rankings, dayNumber);
  const entry = entryFor(dayRanking, activity);
  const band = lowest === highest ? `"${lowest}"` : `between "${lowest}" and "${highest}"`;

  expectTrue(
    isAtLeast(entry.rating, lowest) && RATINGS.indexOf(entry.rating) <= RATINGS.indexOf(highest),
    `Expected ${activity} on day ${dayNumber} (${dayRanking.date}) to be ${band}, got ` +
      `"${entry.rating}" (score ${entry.score}). Reasoning: "${entry.reasoning}"`,
  );
}

Then(
  'on day {int} {string} is rated {string}',
  async ({ api }, dayNumber: number, activity: string, rating: string) => {
    expectRatingWithin(api.rankings(), dayNumber, activity, rating, rating);
  },
);

Then(
  'on day {int} {string} is rated no better than {string}',
  async ({ api }, dayNumber: number, activity: string, ceiling: string) => {
    expectRatingWithin(api.rankings(), dayNumber, activity, RATINGS[0], ceiling);
  },
);

Then(
  'on day {int} {string} is rated between {string} and {string}',
  async ({ api }, dayNumber: number, activity: string, lowest: string, highest: string) => {
    expectRatingWithin(api.rankings(), dayNumber, activity, lowest, highest);
  },
);

Then(
  'on day {int} {string} is ranked {int}',
  async ({ api }, dayNumber: number, activityName: string, rank: number) => {
    const activity = assertActivity(activityName);
    const dayRanking = day(api.rankings(), dayNumber);
    const entry = entryFor(dayRanking, activity);
    expectTrue(
      entry.rank === rank,
      `Expected ${activity} to be rank ${rank} on day ${dayNumber} (${dayRanking.date}), got rank ` +
        `${entry.rank}. Full day: ${describeDay(dayRanking)}`,
    );
  },
);

Then(
  'on day {int} {string} is ranked above {string}',
  async ({ api }, dayNumber: number, higherName: string, lowerName: string) => {
    const higher = assertActivity(higherName);
    const lower = assertActivity(lowerName);
    const dayRanking = day(api.rankings(), dayNumber);
    const a = entryFor(dayRanking, higher);
    const b = entryFor(dayRanking, lower);
    expectTrue(
      a.rank < b.rank,
      `Expected ${higher} to outrank ${lower} on day ${dayNumber} (${dayRanking.date}), but ` +
        `${higher} is rank ${a.rank} and ${lower} is rank ${b.rank}. ${describeDay(dayRanking)}`,
    );
  },
);

Then(
  'on day {int} no activity is rated {string}',
  async ({ api }, dayNumber: number, ratingName: string) => {
    const rating = assertRating(ratingName);
    const dayRanking = day(api.rankings(), dayNumber);
    const offenders = dayRanking.activities.filter((a) => a.rating === rating);
    expectTrue(
      offenders.length === 0,
      `Nothing about this day justifies an "${rating}" verdict, but ` +
        `${offenders.map((o) => `${o.activity} (${o.score})`).join(', ')} got one.`,
    );
  },
);

Then(
  'on day {int} the reasoning for {string} mentions one of {string}',
  async ({ api }, dayNumber: number, activityName: string, needles: string) => {
    const activity = assertActivity(activityName);
    const dayRanking = day(api.rankings(), dayNumber);
    const entry = entryFor(dayRanking, activity);
    expectMentionsAny(
      entry.reasoning,
      needles.split(',').map((n) => n.trim()),
      `the reasoning for ${activity} on day ${dayNumber} (${dayRanking.date})`,
    );
  },
);

Then(
  '{string} scores higher on day {int} than on day {int}',
  async ({ api }, activityName: string, betterDay: number, worseDay: number) => {
    const activity = assertActivity(activityName);
    const rankings = api.rankings();
    const better = entryFor(day(rankings, betterDay), activity);
    const worse = entryFor(day(rankings, worseDay), activity);
    expectTrue(
      better.score > worse.score,
      `Expected ${activity} to score higher on day ${betterDay} than day ${worseDay}, got ` +
        `${better.score} vs ${worse.score}.\n  day ${betterDay}: "${better.reasoning}"\n` +
        `  day ${worseDay}: "${worse.reasoning}"`,
    );
  },
);

Then(
  '{string} is rated at least {string} on every day',
  async ({ api }, activityName: string, ratingName: string) => {
    const activity = assertActivity(activityName);
    const floor = assertRating(ratingName);
    for (const dayRanking of api.rankings().days) {
      const entry = entryFor(dayRanking, activity);
      expectTrue(
        isAtLeast(entry.rating, floor),
        `${activity} dropped to "${entry.rating}" (score ${entry.score}) on ${dayRanking.date}. ` +
          `The contract gives it a floor of "${floor}" so a user always has a workable option.`,
      );
    }
  },
);

Then(
  'every day has at least one activity rated {string} or better',
  async ({ api }, ratingName: string) => {
    const floor = assertRating(ratingName);
    for (const dayRanking of api.rankings().days) {
      const usable = dayRanking.activities.filter((a) => isAtLeast(a.rating, floor));
      expectTrue(
        usable.length > 0,
        `${dayRanking.date} offers the user four dead ends: ${describeDay(dayRanking)}`,
      );
    }
  },
);

// --- ambiguous location -----------------------------------------------------

Then('the error details list the candidate locations', async ({ api }) => {
  const body = api.errorBody();
  parseWith(
    AmbiguousLocationDetailsSchema,
    body.error.details,
    'The details of an AMBIGUOUS_LOCATION error',
  );
});

