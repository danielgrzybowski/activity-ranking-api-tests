/**
 * Domain vocabulary for the Activity Ranking API.
 *
 * This file is the single place where the suite states what the API is
 * supposed to speak. Nothing here is derived from an implementation --
 * it is the contract the specs pin down.
 */

export const ACTIVITIES = [
  'INDOOR_SIGHTSEEING',
  'OUTDOOR_SIGHTSEEING',
  'SKIING',
  'SURFING',
] as const;

export type Activity = (typeof ACTIVITIES)[number];

export const RATINGS = ['UNSUITABLE', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT'] as const;

export type Rating = (typeof RATINGS)[number];

/**
 * Score -> rating bands. The API returns both; the suite asserts they agree,
 * so a drift between the numeric model and the label a user reads is caught.
 */
export const RATING_BANDS: ReadonlyArray<{ rating: Rating; min: number; max: number }> = [
  { rating: 'UNSUITABLE', min: 0, max: 19 },
  { rating: 'POOR', min: 20, max: 39 },
  { rating: 'FAIR', min: 40, max: 59 },
  { rating: 'GOOD', min: 60, max: 79 },
  { rating: 'EXCELLENT', min: 80, max: 100 },
];

export function ratingForScore(score: number): Rating {
  const band = RATING_BANDS.find((b) => score >= b.min && score <= b.max);
  if (!band) throw new Error(`Score ${score} is outside the documented 0-100 range`);
  return band.rating;
}

export function isAtLeast(actual: Rating, minimum: Rating): boolean {
  return RATINGS.indexOf(actual) >= RATINGS.indexOf(minimum);
}

/**
 * Indoor Sightseeing is always an option a user can act on, so the contract
 * gives it a floor. This is a UX decision as much as a scoring one: a
 * front end must never show a day with four dead-end suggestions.
 */
export const INDOOR_SIGHTSEEING_MINIMUM_SCORE = 45;

/** Ties are broken alphabetically by activity name so ranks are reproducible. */
export function expectedRankOrder(
  entries: ReadonlyArray<{ activity: Activity; score: number }>,
): Activity[] {
  return [...entries]
    .sort((a, b) => (b.score - a.score) || a.activity.localeCompare(b.activity))
    .map((e) => e.activity);
}

/** Error codes the contract defines. Specs assert on these, never on prose. */
export const ERROR_CODES = [
  'INVALID_QUERY',
  'MISSING_LOCATION',
  'CONFLICTING_LOCATION_PARAMS',
  'INVALID_DAYS',
  'LOCATION_NOT_FOUND',
  'AMBIGUOUS_LOCATION',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_RATE_LIMITED',
  'UPSTREAM_TIMEOUT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Reasoning is rendered in a card in the UI, so it has a length budget. */
export const REASONING_MAX_LENGTH = 160;

/** Latency budgets, expressed from the front-end experience backwards. */
export const LATENCY_BUDGET_MS = {
  /** Typeahead: fires on every keystroke, must feel instant. */
  locations: 500,
  /** Rankings: the user has committed to a city and is watching a spinner. */
  rankings: 2000,
} as const;
