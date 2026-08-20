import { DataTable, Then, When } from '@cucumber/cucumber';
import { callApi } from '../../src/support/api-client';
import {
  expectEqual,
  expectMentionsAny,
  expectTrue,
  parseWith,
} from '../../src/support/assertions';
import {
  ACTIVITIES,
  RATINGS,
  RATING_BANDS,
  REASONING_MAX_LENGTH,
  expectedRankOrder,
  isAtLeast,
  ratingForScore,
  type Activity,
  type Rating,
} from '../../src/support/domain';
import { fakeOpenMeteo } from '../../src/support/fake-open-meteo';
import {
  AmbiguousLocationDetailsSchema,
  RankingsResponseSchema,
  type ActivityRanking,
  type DayRanking,
  type RankingsResponse,
} from '../../src/support/schemas';
import type { ActivityRankingWorld } from '../../src/support/world';

const RANKINGS_PATH = '/v1/rankings';

/** Vocabulary a reasoning string must draw on to actually explain anything. */
const WEATHER_VOCABULARY = [
  'snow',
  'rain',
  'shower',
  'precipitation',
  'wind',
  'gust',
  'breeze',
  'calm',
  'flat',
  'swell',
  'sun',
  'clear',
  'cloud',
  'overcast',
  'fog',
  'storm',
  'thunder',
  'temperature',
  '°c',
  'degrees',
  'warm',
  'hot',
  'heat',
  'mild',
  'cold',
  'freezing',
  'dry',
  'wet',
  'humid',
];

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

When(
  'I request rankings for location id {string}',
  async function (this: ActivityRankingWorld, locationId: string) {
    this.response = await callApi({ path: RANKINGS_PATH, query: { locationId } });
  },
);

When(
  'I request rankings for location id {string} again',
  async function (this: ActivityRankingWorld, locationId: string) {
    this.repeatResponse = await callApi({ path: RANKINGS_PATH, query: { locationId } });
  },
);

When(
  'I request rankings for location id {string} over {int} days',
  async function (this: ActivityRankingWorld, locationId: string, days: number) {
    this.response = await callApi({ path: RANKINGS_PATH, query: { locationId, days } });
  },
);

// Quoted day counts are the invalid ones: "0", "8", "week".
When(
  'I request rankings for location id {string} over {string} days',
  async function (this: ActivityRankingWorld, locationId: string, days: string) {
    this.response = await callApi({ path: RANKINGS_PATH, query: { locationId, days } });
  },
);

When(
  'I request rankings for the city {string}',
  async function (this: ActivityRankingWorld, city: string) {
    this.response = await callApi({ path: RANKINGS_PATH, query: { city } });
  },
);

When('I request rankings with no location', async function (this: ActivityRankingWorld) {
  this.response = await callApi({ path: RANKINGS_PATH });
});

When(
  'I request rankings for location id {string} and the city {string}',
  async function (this: ActivityRankingWorld, locationId: string, city: string) {
    this.response = await callApi({ path: RANKINGS_PATH, query: { locationId, city } });
  },
);

// --- contract-level assertions ---------------------------------------------

Then('the response matches the rankings contract', function (this: ActivityRankingWorld) {
  parseWith(RankingsResponseSchema, this.lastResponse.body, 'The rankings response');
});

Then(
  'the ranking covers {int} consecutive days starting from the first forecast day',
  function (this: ActivityRankingWorld, expectedCount: number) {
    const days = this.rankings().days;
    expectTrue(
      days.length === expectedCount,
      `Expected ${expectedCount} day(s) of rankings, got ${days.length}.`,
    );

    const start = new Date(`${fakeOpenMeteo.firstForecastDate}T00:00:00Z`);
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

Then('every day ranks all four activities:', function (this: ActivityRankingWorld, table: DataTable) {
  const expected = table.raw().map((row) => assertActivity(row[0]!));
  for (const dayRanking of this.rankings().days) {
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

Then(
  'every activity entry has a date, an activity name, a suitability score and a rating',
  function (this: ActivityRankingWorld) {
    // The schema enforces types; this checks the date is carried per day and
    // that scores are real numbers a UI can put on a bar.
    for (const dayRanking of this.rankings().days) {
      expectTrue(
        /^\d{4}-\d{2}-\d{2}$/.test(dayRanking.date),
        `Expected an ISO date on each day, got "${dayRanking.date}"`,
      );
      for (const entry of dayRanking.activities) {
        expectTrue(
          Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 100,
          `${entry.activity} on ${dayRanking.date} has score ${entry.score}, outside the documented 0-100 range.`,
        );
        expectTrue(
          (RATINGS as readonly string[]).includes(entry.rating),
          `${entry.activity} on ${dayRanking.date} has an unknown rating "${entry.rating}".`,
        );
      }
    }
  },
);

Then(
  'every reasoning is at most {int} characters',
  function (this: ActivityRankingWorld, limit: number) {
    for (const dayRanking of this.rankings().days) {
      for (const entry of dayRanking.activities) {
        expectTrue(
          entry.reasoning.length <= limit,
          `${entry.activity} on ${dayRanking.date} has a ${entry.reasoning.length}-character reasoning, ` +
            `over the ${limit}-character budget for a card: "${entry.reasoning}"`,
        );
      }
    }
    expectEqual(limit, REASONING_MAX_LENGTH, 'the documented reasoning budget');
  },
);

/**
 * "Suitable" on its own tells the user nothing. Every reasoning has to name
 * a driver or quote a number, which is what makes the ranking explainable.
 */
Then('every reasoning refers to at least one weather driver', function (this: ActivityRankingWorld) {
  for (const dayRanking of this.rankings().days) {
    for (const entry of dayRanking.activities) {
      const text = entry.reasoning.toLowerCase();
      const namesDriver = WEATHER_VOCABULARY.some((word) => text.includes(word));
      const quotesNumber = /\d/.test(text);
      expectTrue(
        namesDriver || quotesNumber,
        `${entry.activity} on ${dayRanking.date} gives no reason a user could act on: "${entry.reasoning}"`,
      );
    }
  }
});

Then(
  'every day numbers its activities 1 to 4 with no gaps or duplicates',
  function (this: ActivityRankingWorld) {
    for (const dayRanking of this.rankings().days) {
      const ranks = dayRanking.activities.map((a) => a.rank).sort((a, b) => a - b);
      const expected = Array.from({ length: dayRanking.activities.length }, (_, i) => i + 1);
      expectTrue(
        JSON.stringify(ranks) === JSON.stringify(expected),
        `Day ${dayRanking.date} has ranks [${ranks.join(', ')}], expected [${expected.join(', ')}]. ` +
          describeDay(dayRanking),
      );
    }
  },
);

Then('within each day a better score never has a worse rank', function (this: ActivityRankingWorld) {
  for (const dayRanking of this.rankings().days) {
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

Then('activities tied on score are ordered alphabetically', function (this: ActivityRankingWorld) {
  for (const dayRanking of this.rankings().days) {
    const expected = expectedRankOrder(dayRanking.activities);
    const actual = [...dayRanking.activities]
      .sort((a, b) => a.rank - b.rank)
      .map((a) => a.activity);
    expectTrue(
      JSON.stringify(actual) === JSON.stringify(expected),
      `On ${dayRanking.date} the documented tie-break (score desc, then activity name) gives ` +
        `[${expected.join(', ')}], but the API returned [${actual.join(', ')}]. ${describeDay(dayRanking)}`,
    );
  }
});

Then('every rating matches the documented band for its score', function (this: ActivityRankingWorld) {
  const bands = RATING_BANDS.map((b) => `${b.rating} ${b.min}-${b.max}`).join(', ');
  for (const dayRanking of this.rankings().days) {
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

Then('the resolved location is {string}', function (this: ActivityRankingWorld, displayName: string) {
  expectEqual(this.rankings().location.displayName, displayName, 'the resolved location');
});

Then('the resolved location id is {string}', function (this: ActivityRankingWorld, id: string) {
  expectEqual(this.rankings().location.id, id, 'the resolved location id');
});

Then(
  'the response declares units for temperature, precipitation, snowfall and wind speed',
  function (this: ActivityRankingWorld) {
    const units = this.rankings().units;
    for (const [key, value] of Object.entries(units)) {
      expectTrue(
        typeof value === 'string' && value.length > 0,
        `The response declares no unit for ${key}, so the numbers in the reasoning are ambiguous.`,
      );
    }
  },
);

Then('the forecast source is {string}', function (this: ActivityRankingWorld, source: string) {
  expectEqual(this.rankings().forecast.source, source, 'the forecast source');
});

Then('the forecast timezone is {string}', function (this: ActivityRankingWorld, timezone: string) {
  expectEqual(this.rankings().forecast.timezone, timezone, 'the forecast timezone');
});

Then(
  'both responses are identical apart from the generation timestamp',
  function (this: ActivityRankingWorld) {
    const second = this.repeatResponse;
    expectTrue(second !== undefined, 'The scenario did not make a second request.');

    const strip = (body: unknown): string => {
      const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
      delete clone['generatedAt'];
      return JSON.stringify(clone);
    };

    expectTrue(
      strip(this.lastResponse.body) === strip(second!.body),
      'The same forecast produced two different rankings. Nothing downstream - caching, ' +
        'sharing a link, comparing two tabs - can be trusted if the ranking is not deterministic.',
    );
  },
);

// --- scoring assertions -----------------------------------------------------

Then(
  'on day {int} {string} is rated {string}',
  function (this: ActivityRankingWorld, dayNumber: number, activityName: string, ratingName: string) {
    const activity = assertActivity(activityName);
    const rating = assertRating(ratingName);
    const dayRanking = day(this.rankings(), dayNumber);
    const entry = entryFor(dayRanking, activity);
    expectTrue(
      entry.rating === rating,
      `Expected ${activity} on day ${dayNumber} (${dayRanking.date}) to be "${rating}", got ` +
        `"${entry.rating}" (score ${entry.score}). Reasoning: "${entry.reasoning}"`,
    );
  },
);

Then(
  'on day {int} {string} is rated no better than {string}',
  function (this: ActivityRankingWorld, dayNumber: number, activityName: string, ratingName: string) {
    const activity = assertActivity(activityName);
    const ceiling = assertRating(ratingName);
    const dayRanking = day(this.rankings(), dayNumber);
    const entry = entryFor(dayRanking, activity);
    expectTrue(
      RATINGS.indexOf(entry.rating) <= RATINGS.indexOf(ceiling),
      `Expected ${activity} on day ${dayNumber} (${dayRanking.date}) to be no better than "${ceiling}", ` +
        `got "${entry.rating}" (score ${entry.score}). Reasoning: "${entry.reasoning}"`,
    );
  },
);

Then(
  'on day {int} {string} is rated between {string} and {string}',
  function (
    this: ActivityRankingWorld,
    dayNumber: number,
    activityName: string,
    lowestName: string,
    highestName: string,
  ) {
    const activity = assertActivity(activityName);
    const lowest = assertRating(lowestName);
    const highest = assertRating(highestName);
    const dayRanking = day(this.rankings(), dayNumber);
    const entry = entryFor(dayRanking, activity);
    expectTrue(
      isAtLeast(entry.rating, lowest) && RATINGS.indexOf(entry.rating) <= RATINGS.indexOf(highest),
      `Expected ${activity} on day ${dayNumber} (${dayRanking.date}) to land between "${lowest}" and ` +
        `"${highest}", got "${entry.rating}" (score ${entry.score}). Reasoning: "${entry.reasoning}"`,
    );
  },
);

Then(
  'on day {int} {string} is ranked {int}',
  function (this: ActivityRankingWorld, dayNumber: number, activityName: string, rank: number) {
    const activity = assertActivity(activityName);
    const dayRanking = day(this.rankings(), dayNumber);
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
  function (this: ActivityRankingWorld, dayNumber: number, higherName: string, lowerName: string) {
    const higher = assertActivity(higherName);
    const lower = assertActivity(lowerName);
    const dayRanking = day(this.rankings(), dayNumber);
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
  function (this: ActivityRankingWorld, dayNumber: number, ratingName: string) {
    const rating = assertRating(ratingName);
    const dayRanking = day(this.rankings(), dayNumber);
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
  function (this: ActivityRankingWorld, dayNumber: number, activityName: string, needles: string) {
    const activity = assertActivity(activityName);
    const dayRanking = day(this.rankings(), dayNumber);
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
  function (this: ActivityRankingWorld, activityName: string, betterDay: number, worseDay: number) {
    const activity = assertActivity(activityName);
    const rankings = this.rankings();
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
  '{string} scores are in descending order across days {int}, {int}, {int}',
  function (this: ActivityRankingWorld, activityName: string, a: number, b: number, c: number) {
    const activity = assertActivity(activityName);
    const rankings = this.rankings();
    const scores = [a, b, c].map((n) => entryFor(day(rankings, n), activity).score);
    expectTrue(
      scores[0]! >= scores[1]! && scores[1]! >= scores[2]!,
      `Expected ${activity} scores to fall across days ${a}, ${b}, ${c}, got [${scores.join(', ')}]. ` +
        `A ranking that is not monotonic in its main driver cannot be explained to a user.`,
    );
  },
);

Then(
  '{string} is rated at least {string} on every day',
  function (this: ActivityRankingWorld, activityName: string, ratingName: string) {
    const activity = assertActivity(activityName);
    const floor = assertRating(ratingName);
    for (const dayRanking of this.rankings().days) {
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
  function (this: ActivityRankingWorld, ratingName: string) {
    const floor = assertRating(ratingName);
    for (const dayRanking of this.rankings().days) {
      const usable = dayRanking.activities.filter((a) => isAtLeast(a.rating, floor));
      expectTrue(
        usable.length > 0,
        `${dayRanking.date} offers the user four dead ends: ${describeDay(dayRanking)}`,
      );
    }
  },
);

// --- ambiguous location -----------------------------------------------------

Then('the error details list the candidate locations', function (this: ActivityRankingWorld) {
  const body = this.errorBody();
  parseWith(
    AmbiguousLocationDetailsSchema,
    body.error.details,
    'The details of an AMBIGUOUS_LOCATION error',
  );
});

Then('each candidate carries the location id needed to retry', function (this: ActivityRankingWorld) {
  const details = parseWith(
    AmbiguousLocationDetailsSchema,
    this.errorBody().error.details,
    'The details of an AMBIGUOUS_LOCATION error',
  );
  for (const candidate of details.matches) {
    expectTrue(
      candidate.id.length > 0 && candidate.displayName.length > 0,
      `Candidate ${JSON.stringify(candidate)} cannot be turned into a retry: a picker needs both an ` +
        `id and a label.`,
    );
  }
});
