import { AssertionError } from 'node:assert';
import {
  INDOOR_SIGHTSEEING_MINIMUM_SCORE,
  REASONING_MAX_LENGTH,
  expectedRankOrder,
  ratingForScore,
} from './domain';
import { RankingsResponseSchema, type RankingsResponse } from './schemas';

/**
 * Properties that must hold of every ranking the API ever returns, whatever
 * the weather or the city.
 *
 * These are checked automatically after each scenario that produced a 200
 * from the rankings endpoint, not just where a feature file names them. Some
 * rules - the alphabetical tie-break above all - can only be exercised when
 * the data happens to produce a tie, which no fixture can force from weather
 * inputs alone. Checking them everywhere is what turns "we wrote it down" into
 * "we would notice". A mutation run confirmed the difference: a build with the
 * tie-break removed passed the suite before this existed and fails it now.
 */

function fail(message: string): never {
  throw new AssertionError({ message: `Ranking invariant violated: ${message}` });
}

export function assertRankingInvariants(rankings: RankingsResponse): void {
  for (const day of rankings.days) {
    const describe = day.activities
      .map((a) => `${a.activity}=${a.score}/${a.rating}(rank ${a.rank})`)
      .join(', ');

    const ranks = day.activities.map((a) => a.rank).sort((a, b) => a - b);
    const expectedRanks = day.activities.map((_, i) => i + 1);
    if (JSON.stringify(ranks) !== JSON.stringify(expectedRanks)) {
      fail(`${day.date} has ranks [${ranks.join(', ')}], expected [${expectedRanks.join(', ')}]. ${describe}`);
    }

    const expectedOrder = expectedRankOrder(day.activities);
    const actualOrder = [...day.activities].sort((a, b) => a.rank - b.rank).map((a) => a.activity);
    if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
      fail(
        `${day.date} orders activities [${actualOrder.join(', ')}], but score-descending with an ` +
          `alphabetical tie-break gives [${expectedOrder.join(', ')}]. ${describe}`,
      );
    }

    for (const entry of day.activities) {
      const expectedRating = ratingForScore(entry.score);
      if (entry.rating !== expectedRating) {
        fail(
          `${entry.activity} on ${day.date} scores ${entry.score} but is labelled "${entry.rating}"; ` +
            `the documented bands make that "${expectedRating}".`,
        );
      }
      if (entry.reasoning.length > REASONING_MAX_LENGTH) {
        fail(
          `${entry.activity} on ${day.date} has a ${entry.reasoning.length}-character reasoning, over ` +
            `the ${REASONING_MAX_LENGTH}-character budget: "${entry.reasoning}"`,
        );
      }
    }

    const indoor = day.activities.find((a) => a.activity === 'INDOOR_SIGHTSEEING');
    if (indoor && indoor.score < INDOOR_SIGHTSEEING_MINIMUM_SCORE) {
      fail(
        `INDOOR_SIGHTSEEING scored ${indoor.score} on ${day.date}, below the documented floor of ` +
          `${INDOOR_SIGHTSEEING_MINIMUM_SCORE}. A user must always have one workable option.`,
      );
    }
  }
}

/** Returns the parsed rankings when the response was one, otherwise undefined. */
export function asRankingsResponse(status: number, body: unknown): RankingsResponse | undefined {
  if (status !== 200) return undefined;
  const parsed = RankingsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}
