/**
 * The Open-Meteo client, and the one place where somebody else's outage is
 * turned into an answer this API can give its own user.
 */

import { mutated } from './mutations';
import type { DailyWeather } from './scoring';

export interface Place {
  id: string;
  name: string;
  country: string | null;
  countryCode: string;
  region: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number | null;
  displayName: string;
}

export class UpstreamError extends Error {
  constructor(
    /** Distinguishable, because the front end renders each differently. */
    readonly kind: 'unavailable' | 'rate_limited' | 'timeout',
    message: string,
    readonly retryAfter?: string,
    /** The upstream status, where there was one. */
    readonly status?: number,
  ) {
    super(message);
  }
}

const GEOCODING_BASE = process.env['OPEN_METEO_GEOCODING_BASE_URL'] ?? 'https://geocoding-api.open-meteo.com';
const FORECAST_BASE = process.env['OPEN_METEO_FORECAST_BASE_URL'] ?? 'https://api.open-meteo.com';

/**
 * Well under the 2s the user is promised. A hung upstream must not become a
 * hung request: giving up early is what lets the API say "try again shortly"
 * while the spinner is still plausible.
 */
const TIMEOUT_MS = Number.parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '1200', 10);

/** Exactly the daily variables the ranking reads. Asking for less is an outage. */
export const DAILY_VARIABLES = [
  'weather_code',
  'temperature_2m_max',
  'precipitation_sum',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'sunshine_duration',
];

/** `${base}/v1/search`, whether or not the base URL carries a path of its own. */
const upstreamUrl = (base: string, path: string): URL => new URL(`${base.replace(/\/$/, '')}${path}`);

async function get(url: URL): Promise<{ status: number; body: any; retryAfter?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }

    if (response.status === 429) {
      throw new UpstreamError('rate_limited', 'Open-Meteo is rate limiting this key', response.headers.get('retry-after') ?? '60');
    }
    if (response.status >= 400 || typeof body !== 'object' || body === null) {
      throw new UpstreamError(
        'unavailable',
        `Open-Meteo answered ${response.status} with a body we cannot use`,
        undefined,
        response.status,
      );
    }
    return { status: response.status, body };
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new UpstreamError('timeout', `Open-Meteo did not answer within ${TIMEOUT_MS}ms`);
    }
    throw new UpstreamError('unavailable', `Open-Meteo could not be reached: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

interface GeoResult {
  id: number;
  name: string;
  feature_code?: string;
  admin2?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population?: number;
}

/**
 * "Name, Region, Country" is enough for three Londons in three countries. It
 * is not enough for the four pairs of Londons that share a US state - two in
 * Ohio, two in Texas, two in Alabama, two in Minnesota - and two identical
 * rows in a picker are the same dead end, one level down. Where the coarse
 * label collides inside a response, the colliding entries reach for the
 * county. Only they do: the other rows stay short.
 */
function labelFor(r: GeoResult, withSubregion: boolean): string {
  const parts = withSubregion ? [r.name, r.admin2, r.admin1, r.country] : [r.name, r.admin1, r.country];
  return parts.filter(Boolean).join(', ');
}

function disambiguate(results: GeoResult[]): Map<number, string> {
  const counts = new Map<string, number>();
  for (const r of results) {
    const label = labelFor(r, false);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return new Map(
    results.map((r) => {
      const short = labelFor(r, false);
      const needsMore = (counts.get(short) ?? 0) > 1 && !mutated('flat_display_names');
      const long = labelFor(r, true);
      // If even the county does not separate them, the short label is no worse.
      return [r.id, needsMore && long !== short ? long : short];
    }),
  );
}

function toPlace(r: GeoResult): Place {
  return {
    id: String(r.id),
    name: r.name,
    country: r.country ?? null,
    countryCode: r.country_code ?? '',
    region: r.admin1 ?? null,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    population: r.population ?? null,
    // The label a picker shows, built here so the front end never has to guess.
    // Replaced below where it would collide with another row in the response.
    displayName: labelFor(r, false),
  };
}

/**
 * Most prominent first, with an unknown population last rather than first: a
 * town Open-Meteo knows nothing about is not the one the user meant.
 */
function byProminence(a: Place, b: Place): number {
  if (a.population === b.population) return a.displayName.localeCompare(b.displayName);
  if (a.population === null) return 1;
  if (b.population === null) return -1;
  return b.population - a.population;
}

/**
 * Open-Meteo's catalogue is not a list of towns. It carries airports,
 * heliports, mountains and lakes, and they share their town's name: "Zermatt"
 * comes back twice, once as the village and once as its heliport, with the
 * same region and country - so a picker built from the raw results shows the
 * user the same label twice and asks them to choose.
 *
 * A GeoNames feature code starting with PPL is a populated place, which is
 * what "city or town name" means. A result with no feature code at all is kept
 * rather than dropped: we cannot prove it is not a town.
 */
const isSettlement = (r: GeoResult): boolean =>
  mutated('keep_airfields') || r.feature_code === undefined || r.feature_code.startsWith('PPL');

/**
 * Open-Meteo applies `count` before we get to filter, so asking it for exactly
 * `limit` and then dropping the airfields hands the caller a short list: a
 * dropdown that asked for ten suggestions gets six, and the towns that would
 * have filled the gap are on a page we never fetched. Fetch with headroom,
 * trim after filtering. 100 is Open-Meteo's own ceiling on `count`.
 */
const OVER_FETCH = 3;

export async function searchPlaces(name: string, limit: number): Promise<Place[]> {
  const url = upstreamUrl(GEOCODING_BASE, '/v1/search');
  url.searchParams.set('name', name);
  url.searchParams.set('count', String(Math.min(limit * OVER_FETCH, 100)));
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  // Open-Meteo omits `results` entirely when nothing matched.
  const { body } = await get(url);
  const visible = ((body.results ?? []) as GeoResult[])
    .filter(isSettlement)
    .sort((a, b) => byProminence(toPlace(a), toPlace(b)))
    .slice(0, limit);

  // Collisions are judged on what the picker will actually show, so this runs
  // after the list has been trimmed rather than on everything upstream sent.
  const labels = disambiguate(visible);
  return visible.map((r) => ({ ...toPlace(r), displayName: labels.get(r.id)! }));
}

/**
 * Accent- and case-insensitive, because "zurich" and "Zurich" are what people
 * type for Zurich. Nothing else is normalised away: "100 Mile House",
 * "N'Djamena" and "'s-Hertogenbosch" are real names, and stripping their
 * punctuation would make them unreachable.
 */
const normaliseName = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

/**
 * Enough headroom that the exact matches are not pushed off the end by more
 * populous places that merely start with the same letters.
 */
const CITY_MATCH_LIMIT = 20;

/**
 * Places whose name *is* what the caller typed, not merely places whose name
 * starts with it.
 *
 * Open-Meteo's geocoding is a prefix search, which is exactly right for the
 * typeahead and exactly wrong here: `city` is the shortcut for a name the user
 * has already settled on, so "Cham" has to mean Cham and not Chamonix. Passing
 * the prefix results straight through would rank whichever of the two the
 * upstream happened to sort first, and the user would never learn which.
 */
export async function findPlacesNamed(name: string): Promise<Place[]> {
  const wanted = normaliseName(name);
  const candidates = await searchPlaces(name, CITY_MATCH_LIMIT);
  if (mutated('prefix_match_city')) return candidates;
  return candidates.filter((place) => normaliseName(place.name) === wanted);
}

export async function getPlace(id: string): Promise<Place | undefined> {
  const url = upstreamUrl(GEOCODING_BASE, '/v1/get');
  url.searchParams.set('id', id);
  url.searchParams.set('format', 'json');
  try {
    return toPlace((await get(url)).body as GeoResult);
  } catch (error) {
    // A 404 here is "no such place", not an outage.
    if (error instanceof UpstreamError && error.status === 404) return undefined;
    throw error;
  }
}

export async function getForecast(
  place: Place,
  days: number,
): Promise<{ timezone: string; days: DailyWeather[] }> {
  const url = upstreamUrl(FORECAST_BASE, '/v1/forecast');
  url.searchParams.set('latitude', String(place.latitude));
  url.searchParams.set('longitude', String(place.longitude));
  url.searchParams.set('forecast_days', String(days));
  url.searchParams.set('daily', DAILY_VARIABLES.join(','));
  url.searchParams.set('timezone', 'auto');

  const { body } = await get(url);
  const daily = body.daily as Record<string, unknown[]> | undefined;
  const time = (daily?.['time'] ?? []) as string[];
  if (!Array.isArray(time) || time.length === 0) {
    throw new UpstreamError('unavailable', 'Open-Meteo returned a forecast with no days in it');
  }

  const column = (key: string, i: number): number => {
    const value = daily?.[key]?.[i];
    return typeof value === 'number' ? value : 0;
  };

  return {
    timezone: (body.timezone as string) ?? place.timezone,
    days: time.map((date, i) => ({
      date,
      weatherCode: column('weather_code', i),
      temperatureMax: column('temperature_2m_max', i),
      precipitationMm: column('precipitation_sum', i),
      snowfallCm: column('snowfall_sum', i),
      windSpeedKmh: column('wind_speed_10m_max', i),
      windGustsKmh: column('wind_gusts_10m_max', i),
      sunshineHours: column('sunshine_duration', i) / 3600,
    })),
  };
}
