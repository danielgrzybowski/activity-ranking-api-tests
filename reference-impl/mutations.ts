/**
 * Deliberate defects, switched on by an environment variable.
 *
 * A green suite proves the specification is satisfiable. It does not prove the
 * assertions are load-bearing - a suite of `expect(true)` would also be green.
 * `npm run mutation-run` starts this API once per mutation and reports which
 * ones the suite notices, which turns "the tests look thorough" into a number.
 *
 * Each mutation is a mistake a competent implementation could actually make,
 * not a randomly flipped operator: mapping one upstream failure onto another,
 * being helpful about an ambiguous city, trusting the forecast to tell you
 * whether a place has a coast.
 *
 *   MUTATIONS=excellent_at_78 npm run demo:green
 */

export const MUTATIONS = {
  rate_limit_as_502: 'Report an upstream 429 as a generic 502 rather than 503 UPSTREAM_RATE_LIMITED',
  no_days_validation: 'Silently clamp an out-of-range `days` instead of rejecting it',
  resolve_ambiguous_silently: 'Pick the first match for an ambiguous city instead of returning 409',
  excellent_at_78: 'Move the EXCELLENT band boundary from 80 down to 78',
  no_indoor_floor: 'Model indoor sightseeing as a plain mirror of the outdoors, with no floor under it',
  no_tie_break: 'Order tied activities reverse-alphabetically instead of alphabetically',
  ignore_terrain: 'Score surfing and skiing from the weather alone, ignoring whether the place has a coast or a ski area',
  keep_airfields: "Offer Open-Meteo's airports and heliports as places to visit, alongside the towns they are named after",
  flat_display_names: 'Always label a place "Name, Region, Country", even where another result in the same response reads identically',
  echo_origin_without_vary: "Echo the caller's Origin back as Access-Control-Allow-Origin without a Vary: Origin beside it",
  generic_reasoning: 'Explain every activity on a day with the same weather summary, instead of a reason per activity',
  prefix_match_city: 'Resolve `city` by prefix, so "Cham" ranks Chamonix',
} as const;

export type Mutation = keyof typeof MUTATIONS;

let active: Set<string> | undefined;

/** Parsed once, and a typo in the variable is an error rather than a no-op. */
function parse(): Set<string> {
  if (active) return active;
  const names = (process.env['MUTATIONS'] ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  for (const name of names) {
    if (!(name in MUTATIONS)) {
      throw new Error(`Unknown mutation "${name}". Known: ${Object.keys(MUTATIONS).join(', ')}`);
    }
  }
  active = new Set(names);
  return active;
}

export const mutated = (name: Mutation): boolean => parse().has(name);
export const activeMutations = (): Mutation[] => [...parse()] as Mutation[];
