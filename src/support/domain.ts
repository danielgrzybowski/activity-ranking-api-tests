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
 *
 * The number is the bottom of the FAIR band and nothing else, so that the
 * feature files can state the rule in the language a user reads ("rated at
 * least FAIR") and mean exactly what this constant enforces. A floor that sat
 * between two band boundaries would make the Gherkin and the invariant
 * disagree about scores in the gap.
 */
export const INDOOR_SIGHTSEEING_MINIMUM_SCORE = RATING_BANDS.find((b) => b.rating === 'FAIR')!.min;

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

/**
 * Two of the four activities need something of the place and not just of the
 * sky: surfing needs a coast, skiing needs a ski area. The contract answers
 * that with the `feasible` flag on every entry, so the suite reads it rather
 * than guessing at it.
 *
 * Where `feasible` is false the reasoning still has to say *why*: a user
 * reading "Surfing: UNSUITABLE - 8 km/h of wind" for an alpine valley
 * concludes the sea was merely flat that week. This vocabulary is what that
 * check looks for, in place of an exact sentence, so the copy stays free.
 *
 * It is only ever applied to entries the API has already flagged infeasible.
 * Run over every reasoning it would misread "Sea breeze, 19°C" as a
 * declaration that there is no sea - which is exactly why feasibility is a
 * field and not an inference.
 */
export const INFEASIBILITY_MARKERS = ['coast', 'sea', 'ski area', 'inland'];

/**
 * Whole words only, or "a good season for it" reads as a statement about the
 * sea. "coastal" and "coastline" are the same word for this purpose.
 */
const INFEASIBILITY_PATTERN = /\b(coast(al|line)?|sea|ski area|inland)\b/i;

export function explainsInfeasibility(reasoning: string): boolean {
  return INFEASIBILITY_PATTERN.test(reasoning);
}

/**
 * Vocabulary a reasoning has to draw on to explain anything. "Suitable" on its
 * own tells the user a verdict with no reason behind it, and a verdict they
 * cannot interrogate is one they cannot plan around.
 */
export const WEATHER_VOCABULARY = [
  'snow', 'rain', 'shower', 'precipitation', 'wind', 'gust', 'breeze', 'calm',
  'flat', 'swell', 'sun', 'clear', 'cloud', 'overcast', 'fog', 'storm',
  'thunder', 'temperature', '°c', 'degrees', 'warm', 'hot', 'heat', 'mild',
  'cold', 'freezing', 'dry', 'wet', 'humid',
];

/**
 * A figure with a unit attached. A bare digit is not evidence of an
 * explanation - "Rated 3 of 5" quotes a number and says nothing about the
 * weather - so the number has to carry a unit the user can read.
 */
const MEASUREMENT_PATTERN = /\d+(?:\.\d+)?\s*(?:°\s*c|mm|cm|km\/h|kph|m\/s|%|h\b|hours?)/i;

/**
 * A reasoning carries one of exactly two kinds of reason: the weather driver
 * behind the verdict, or the fact that the place cannot support the activity
 * at all. Which of the two is required is decided by `feasible` and never by
 * reading the prose, for the reason given above INFEASIBILITY_MARKERS.
 */
export function explainsVerdict(reasoning: string, feasible: boolean): boolean {
  if (!feasible) return explainsInfeasibility(reasoning);
  const text = reasoning.toLowerCase();
  return WEATHER_VOCABULARY.some((word) => text.includes(word)) || MEASUREMENT_PATTERN.test(text);
}

/**
 * Two activities on the same day must not be explained by the same sentence.
 *
 * The cheapest implementation of "reasoning" is one weather summary pasted
 * under all four cards, and every other rule here passes it: it is inside the
 * length budget, it names a weather driver, and it agrees with no rating in
 * particular. What the user reads is "Indoor Sightseeing - FAIR - Clear skies
 * and 22C", which is a weather report standing where a reason should be, and
 * leaves them unable to tell why one activity beat another.
 *
 * Distinctness is a proxy for "the reason is about the activity it sits
 * under". It is a cheap one, and it is the half a machine can check: a
 * sentence written for skiing does not also read as a sentence about a museum.
 *
 * Whitespace and case are normalised, so two cards differing only in how they
 * were formatted still count as the same sentence.
 */
export function sharedReasonings(
  entries: ReadonlyArray<{ activity: Activity; reasoning: string }>,
): { reasoning: string; activities: Activity[] }[] {
  const groups = new Map<string, { reasoning: string; activities: Activity[] }>();
  for (const entry of entries) {
    const key = entry.reasoning.trim().toLowerCase().replace(/\s+/g, ' ');
    const group = groups.get(key) ?? { reasoning: entry.reasoning, activities: [] };
    group.activities.push(entry.activity);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.activities.length > 1);
}

/** Latency budgets, expressed from the front-end experience backwards. */
export const LATENCY_BUDGET_MS = {
  /** Typeahead: fires on every keystroke, must feel instant. */
  locations: 500,
  /** Rankings: the user has committed to a city and is watching a spinner. */
  rankings: 2000,
} as const;
