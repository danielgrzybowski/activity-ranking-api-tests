/**
 * The ranking model.
 *
 * This exists to prove the specification is satisfiable, not to be the last
 * word on how to score a ski day. The suite never asserts an exact score, so
 * these coefficients are free to change; what the scenarios pin down is the
 * verdict a user reads and the ordering between days.
 */

import { mutated } from './mutations';
import type { Terrain } from './terrain';

export interface DailyWeather {
  date: string;
  weatherCode: number;
  temperatureMax: number;
  precipitationMm: number;
  snowfallCm: number;
  windSpeedKmh: number;
  windGustsKmh: number;
  sunshineHours: number;
}

export type Activity = 'SKIING' | 'SURFING' | 'OUTDOOR_SIGHTSEEING' | 'INDOOR_SIGHTSEEING';
export type Rating = 'UNSUITABLE' | 'POOR' | 'FAIR' | 'GOOD' | 'EXCELLENT';

export interface ScoredActivity {
  activity: Activity;
  /** False where the place cannot support the activity at all. */
  feasible: boolean;
  score: number;
  rating: Rating;
  rank: number;
  reasoning: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const dp = (n: number): number => Math.round(n * 10) / 10;

export function ratingFor(score: number): Rating {
  if (score >= (mutated('excellent_at_78') ? 78 : 80)) return 'EXCELLENT';
  if (score >= 60) return 'GOOD';
  if (score >= 40) return 'FAIR';
  if (score >= 20) return 'POOR';
  return 'UNSUITABLE';
}

/** The bottom of the FAIR band: a user always has one option they can act on. */
const INDOOR_FLOOR = 40;

/**
 * An activity the place cannot support is UNSUITABLE before the weather is
 * read, and says why. Scoring it on the weather alone produces "Surfing:
 * FAIR" for an alpine valley - not a near miss, and indistinguishable from a
 * genuine verdict.
 */
const NOT_POSSIBLE_HERE = {
  SURFING: 'This location has no coast within reach, whatever the wind is doing.',
  SKIING: 'This location has no ski area within reach, whatever the snow is doing.',
} as const;

// --- skiing -----------------------------------------------------------------

function skiing(d: DailyWeather): { score: number; reasoning: string } {
  let score: number;
  if (d.snowfallCm >= 20) score = 92;
  else if (d.snowfallCm >= 10) score = 80;
  else if (d.snowfallCm >= 5) score = 68;
  else if (d.snowfallCm >= 1) score = 55;
  else score = d.temperatureMax <= 0 ? 35 : 10; // No fresh fall: cold keeps a base.

  // Warm air is rain on the piste, then slush, then nothing at all.
  if (d.temperatureMax > 5) score -= 30;
  if (d.temperatureMax > 12) score -= 25;
  if (d.temperatureMax > 25) score -= 20;

  // However much fell, the lifts have to be able to run.
  const windHold = d.windGustsKmh >= 90 || d.windSpeedKmh >= 60;
  if (windHold) score -= 45;
  else if (d.windGustsKmh >= 60 || d.windSpeedKmh >= 40) score -= 20;

  const parts: string[] = [];
  if (d.snowfallCm >= 20) parts.push(`${dp(d.snowfallCm)}cm of fresh powder at ${dp(d.temperatureMax)}°C`);
  else if (d.snowfallCm >= 5) parts.push(`${dp(d.snowfallCm)}cm of new snow at ${dp(d.temperatureMax)}°C`);
  else if (d.snowfallCm >= 1) parts.push(`Only ${dp(d.snowfallCm)}cm of new snow`);
  else if (d.temperatureMax <= 0) parts.push(`No new snow, but holding at ${dp(d.temperatureMax)}°C`);
  else parts.push(`No snow at ${dp(d.temperatureMax)}°C`);

  if (windHold) parts.push(`${dp(d.windGustsKmh)} km/h gusts would put the lifts on wind hold`);
  else if (d.windGustsKmh >= 60) parts.push(`${dp(d.windGustsKmh)} km/h gusts`);
  else if (d.temperatureMax > 5 && d.snowfallCm < 1) parts.push('too warm to fall as snow');

  return { score: clamp(score), reasoning: `${parts.join(', ')}.` };
}

// --- surfing ----------------------------------------------------------------

function surfing(d: DailyWeather): { score: number; reasoning: string } {
  // Wind stands in for swell: nothing at one end, danger at the other.
  let score: number;
  if (d.windSpeedKmh < 5) score = 8;
  else if (d.windSpeedKmh < 10) score = 25;
  else if (d.windSpeedKmh < 15) score = 50;
  else if (d.windSpeedKmh < 18) score = 70;
  else if (d.windSpeedKmh <= 35) score = 92;
  else if (d.windSpeedKmh <= 45) score = 55;
  else if (d.windSpeedKmh <= 55) score = 30;
  else score = 5;

  const stormy = d.windGustsKmh >= 80 || d.windSpeedKmh >= 56;
  if (stormy) score = Math.min(score, 10);
  const tooCold = d.temperatureMax < 8;
  if (tooCold) score = Math.min(score, 30);

  // Cold first: it is the reason that survives whatever the wind is doing.
  const reasoning = tooCold
    ? `Air at ${dp(d.temperatureMax)}°C - too cold to be in the water whatever the wind does.`
    : stormy
      ? `${dp(d.windGustsKmh)} km/h gusts - storm-force wind, unsafe rather than exciting.`
      : d.windSpeedKmh < 10
        ? `Only ${dp(d.windSpeedKmh)} km/h of wind - flat, with no swell to ride.`
        : d.windSpeedKmh <= 35
          ? `A steady ${dp(d.windSpeedKmh)} km/h wind at ${dp(d.temperatureMax)}°C - workable swell.`
          : `${dp(d.windSpeedKmh)} km/h wind at ${dp(d.temperatureMax)}°C - marginal for a surf.`;

  return { score: clamp(score), reasoning };
}

// --- sightseeing ------------------------------------------------------------

function outdoor(d: DailyWeather): { score: number; reasoning: string } {
  const t = d.temperatureMax;
  let score = 100;

  if (t >= 15 && t <= 27) score -= 0;
  else if ((t >= 10 && t < 15) || (t > 27 && t <= 30)) score -= 15;
  else if ((t >= 5 && t < 10) || (t > 30 && t <= 34)) score -= 30;
  else if ((t >= 0 && t < 5) || (t > 34 && t <= 37)) score -= 45;
  else score -= 60;

  if (d.precipitationMm >= 10) score -= 55;
  else if (d.precipitationMm >= 5) score -= 40;
  else if (d.precipitationMm >= 2) score -= 25;
  else if (d.precipitationMm >= 0.5) score -= 8;

  if (d.windSpeedKmh >= 45) score -= 50;
  else if (d.windSpeedKmh >= 30) score -= 30;
  else if (d.windSpeedKmh >= 20) score -= 18;

  const stormy = d.windGustsKmh >= 80 || d.weatherCode >= 95;
  if (d.windGustsKmh >= 80) score -= 25;
  if (d.weatherCode >= 95) score -= 30; // Thunderstorm codes.

  if (d.sunshineHours < 2) score -= 18;
  else if (d.sunshineHours < 4) score -= 10;
  else if (d.sunshineHours < 6) score -= 4;
  else if (d.sunshineHours >= 8) score += 4;

  const reasoning = stormy
    ? `Storm conditions with ${dp(d.windGustsKmh)} km/h gusts - not a day to be out in.`
    : d.precipitationMm >= 10
      ? `${dp(d.precipitationMm)}mm of rain at ${dp(t)}°C.`
      : t >= 32
        ? `${dp(t)}°C heat - hard going on foot for a whole day.`
        : t <= 5
          ? `Only ${dp(t)}°C outside, and ${dp(d.sunshineHours)}h of sunshine.`
          : d.precipitationMm < 0.5 && d.sunshineHours >= 8
            ? `Clear skies, dry and ${dp(t)}°C.`
            : d.sunshineHours < 4
              ? `Grey at ${dp(t)}°C with ${dp(d.precipitationMm)}mm of rain.`
              : `${dp(t)}°C, ${dp(d.precipitationMm)}mm of rain and ${dp(d.windSpeedKmh)} km/h of wind.`;

  return { score: clamp(score), reasoning };
}

/**
 * The mirror of the outdoors, with a floor. A museum is open whatever the sky
 * is doing, so this is what stops a week of storms leaving a user with four
 * dead ends - a product decision, not a weather one.
 */
function indoor(d: DailyWeather, outdoorScore: number): { score: number; reasoning: string } {
  // Removing the `Math.max` alone mutates nothing: this curve bottoms out at
  // 43, above the floor, so the branch is unreachable. The mutation is instead
  // the model an implementation without a floor actually writes - a straight
  // mirror of the outdoors - which reaches 0 on a clear summer afternoon and
  // leaves the user a day with no fourth option at all.
  const score = mutated('no_indoor_floor')
    ? 100 - outdoorScore
    : Math.max(INDOOR_FLOOR, 88 - outdoorScore * 0.45);
  return {
    score: clamp(score),
    reasoning:
      outdoorScore < 40
        ? `${dp(d.precipitationMm)}mm of rain and ${dp(d.windSpeedKmh)} km/h wind outside; galleries and museums are not affected.`
        : `Open whatever the sky does, though at ${dp(d.temperatureMax)}°C and mostly dry the streets are the better bet.`,
  };
}

// --- assembling the day -----------------------------------------------------

export function rankDay(day: DailyWeather, terrain: Terrain): ScoredActivity[] {
  const out = outdoor(day);

  // Only these two need something of the place. Sightseeing needs neither:
  // every town has streets, and somewhere to shelter.
  const canSki = terrain.hasSkiArea || mutated('ignore_terrain');
  const canSurf = terrain.hasCoast || mutated('ignore_terrain');

  const entries: Omit<ScoredActivity, 'rank' | 'rating'>[] = [
    canSki
      ? { activity: 'SKIING', feasible: true, ...skiing(day) }
      : { activity: 'SKIING', feasible: false, score: 0, reasoning: NOT_POSSIBLE_HERE.SKIING },
    canSurf
      ? { activity: 'SURFING', feasible: true, ...surfing(day) }
      : { activity: 'SURFING', feasible: false, score: 0, reasoning: NOT_POSSIBLE_HERE.SURFING },
    { activity: 'OUTDOOR_SIGHTSEEING', feasible: true, ...out },
    { activity: 'INDOOR_SIGHTSEEING', feasible: true, ...indoor(day, out.score) },
  ];

  // The cheap implementation of "reasoning": one summary of the day, pasted
  // under every card. Applied only where the activity is possible, so the
  // rule under test is the only one that can catch it - an infeasible entry
  // still says why, and `explainsVerdict` stays out of the measurement.
  if (mutated('generic_reasoning')) {
    for (const entry of entries) if (entry.feasible) entry.reasoning = out.reasoning;
  }

  // Ties break alphabetically, so two equally good activities do not swap
  // places between refreshes.
  return entries
    .sort((a, b) => b.score - a.score || (mutated('no_tie_break') ? -1 : 1) * a.activity.localeCompare(b.activity))
    .map((entry, i) => ({ ...entry, rating: ratingFor(entry.score), rank: i + 1 }));
}
