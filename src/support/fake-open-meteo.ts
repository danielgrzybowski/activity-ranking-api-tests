import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { DEFAULT_PROFILE_KEY, getProfile, type DailyWeather } from './fixtures/weather-profiles';

/**
 * An in-process stand-in for Open-Meteo.
 *
 * The API under test is expected to take its Open-Meteo base URLs from the
 * environment, so the suite points it here:
 *
 *   OPEN_METEO_GEOCODING_BASE_URL=http://localhost:8787/geocoding
 *   OPEN_METEO_FORECAST_BASE_URL=http://localhost:8787/forecast
 *
 * That keeps every scenario deterministic (a "25cm of powder" day is a fact,
 * not a hope about next Tuesday) and lets the suite exercise upstream
 * failures that would otherwise be unreachable. The same specs can be run
 * against the real service with `npm run test:live`.
 *
 * Response shapes mirror the real Open-Meteo payloads, including the quirk
 * that a geocoding search with no matches omits the `results` key entirely
 * rather than returning an empty array.
 */

export interface GeoPlace {
  id: number;
  name: string;
  admin1: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number;
}

export type UpstreamBehaviour =
  | 'ok'
  | 'server_error'
  | 'rate_limited'
  | 'timeout'
  | 'malformed'
  | 'bad_request';

export interface RecordedRequest {
  service: 'geocoding' | 'forecast';
  path: string;
  query: Record<string, string>;
  receivedAt: number;
}

const DEFAULT_FORECAST_DAYS = 7;

/** Accent-insensitive, case-insensitive comparison key. */
export function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class FakeOpenMeteo {
  private server: Server | undefined;
  private port = 0;
  private readonly openSockets = new Set<ServerResponse>();

  places: GeoPlace[] = [];
  geocodingBehaviour: UpstreamBehaviour = 'ok';
  forecastBehaviour: UpstreamBehaviour = 'ok';

  /** placeId -> ordered list of profile keys, one per forecast day. */
  private readonly forecastPlans = new Map<number, string[]>();
  private defaultProfileKey = DEFAULT_PROFILE_KEY;
  private forecastDayCount = DEFAULT_FORECAST_DAYS;

  /** First date of every forecast, so specs can assert without a clock race. */
  firstForecastDate: string = isoDate(new Date());

  readonly requests: RecordedRequest[] = [];

  async start(port: number): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    for (const res of this.openSockets) res.destroy();
    this.openSockets.clear();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get geocodingBaseUrl(): string {
    return `${this.baseUrl}/geocoding`;
  }

  get forecastBaseUrl(): string {
    return `${this.baseUrl}/forecast`;
  }

  reset(): void {
    this.places = [];
    this.geocodingBehaviour = 'ok';
    this.forecastBehaviour = 'ok';
    this.forecastPlans.clear();
    this.defaultProfileKey = DEFAULT_PROFILE_KEY;
    this.forecastDayCount = DEFAULT_FORECAST_DAYS;
    this.firstForecastDate = isoDate(new Date());
    this.requests.length = 0;
    for (const res of this.openSockets) res.destroy();
    this.openSockets.clear();
  }

  // --- scenario setup ------------------------------------------------------

  setPlaces(places: GeoPlace[]): void {
    this.places = places;
  }

  /** Every day of this place's forecast uses the same profile. */
  setUniformForecast(placeId: number, profileKey: string): void {
    getProfile(profileKey);
    this.forecastPlans.set(placeId, Array.from({ length: this.forecastDayCount }, () => profileKey));
  }

  /** `dayNumber` is 1-based, matching how the feature files talk about days. */
  setForecastDay(placeId: number, dayNumber: number, profileKey: string): void {
    getProfile(profileKey);
    const plan =
      this.forecastPlans.get(placeId) ??
      Array.from({ length: this.forecastDayCount }, () => this.defaultProfileKey);
    while (plan.length < dayNumber) plan.push(this.defaultProfileKey);
    plan[dayNumber - 1] = profileKey;
    this.forecastPlans.set(placeId, plan);
  }

  /** Upstream returns fewer than the requested days -- it does happen. */
  setForecastDayCount(count: number): void {
    this.forecastDayCount = count;
    for (const [placeId, plan] of this.forecastPlans) {
      const trimmed = plan.slice(0, count);
      while (trimmed.length < count) trimmed.push(this.defaultProfileKey);
      this.forecastPlans.set(placeId, trimmed);
    }
  }

  findPlaceByLabel(label: string): GeoPlace {
    const wanted = normalise(label);
    const exact = this.places.filter(
      (p) => normalise(`${p.name}, ${p.admin1}, ${p.country}`) === wanted,
    );
    if (exact.length === 1) return exact[0]!;

    const byName = this.places.filter((p) => normalise(p.name) === wanted);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) {
      throw new Error(
        `"${label}" matches ${byName.length} places in the fixture. ` +
          `Use the full "Name, Region, Country" form in the step.`,
      );
    }
    throw new Error(`No place named "${label}" is loaded in the Open-Meteo test double.`);
  }

  requestsFor(service: 'geocoding' | 'forecast'): RecordedRequest[] {
    return this.requests.filter((r) => r.service === service);
  }

  // --- request handling ----------------------------------------------------

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const query = Object.fromEntries(url.searchParams.entries());

    if (url.pathname.startsWith('/geocoding')) {
      this.requests.push({ service: 'geocoding', path: url.pathname, query, receivedAt: Date.now() });

      // Open-Meteo exposes lookup-by-id separately from search-by-name.
      if (url.pathname.endsWith('/get')) {
        const place = this.places.find((p) => String(p.id) === query['id']);
        if (!place && this.geocodingBehaviour === 'ok') {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: true, reason: 'No matching result found' }));
          return;
        }
        this.respond(res, this.geocodingBehaviour, () => this.placePayload(place!));
        return;
      }

      this.respond(res, this.geocodingBehaviour, () => this.geocodingPayload(query));
      return;
    }

    if (url.pathname.startsWith('/forecast')) {
      this.requests.push({ service: 'forecast', path: url.pathname, query, receivedAt: Date.now() });
      this.respond(res, this.forecastBehaviour, () => this.forecastPayload(query));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: true, reason: 'Not found' }));
  }

  private respond(
    res: ServerResponse,
    behaviour: UpstreamBehaviour,
    build: () => unknown,
  ): void {
    switch (behaviour) {
      case 'timeout':
        // Accept the connection and never answer, so the caller must time out.
        this.openSockets.add(res);
        res.on('close', () => this.openSockets.delete(res));
        return;
      case 'server_error':
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: true, reason: 'Internal server error' }));
        return;
      case 'rate_limited':
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
        res.end(
          JSON.stringify({ error: true, reason: 'Daily API request limit exceeded. Please try again tomorrow.' }),
        );
        return;
      case 'bad_request':
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: true, reason: 'Cannot initialize WeatherVariable from invalid String value' }));
        return;
      case 'malformed':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"daily": {"time": ["2026-0');
        return;
      case 'ok':
      default: {
        const body = JSON.stringify(build());
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(body);
      }
    }
  }

  private placePayload(place: GeoPlace): unknown {
    return {
      id: place.id,
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      elevation: 25,
      feature_code: 'PPL',
      country_code: place.country_code,
      admin1: place.admin1,
      timezone: place.timezone,
      population: place.population,
      country: place.country,
    };
  }

  private geocodingPayload(query: Record<string, string>): unknown {
    const name = normalise(query['name'] ?? '');
    const count = Number.parseInt(query['count'] ?? '10', 10) || 10;

    const matches = this.places
      .filter((p) => normalise(p.name).startsWith(name))
      .sort((a, b) => b.population - a.population)
      .slice(0, count)
      .map((p) => this.placePayload(p));

    // Real Open-Meteo omits `results` entirely when nothing matches.
    return matches.length > 0
      ? { results: matches, generationtime_ms: 0.42 }
      : { generationtime_ms: 0.31 };
  }

  private forecastPayload(query: Record<string, string>): unknown {
    const latitude = Number.parseFloat(query['latitude'] ?? '');
    const longitude = Number.parseFloat(query['longitude'] ?? '');
    const place = this.nearestPlace(latitude, longitude);

    const requested = Number.parseInt(query['forecast_days'] ?? '', 10);
    const dayCount = Math.min(
      Number.isNaN(requested) ? this.forecastDayCount : requested,
      this.forecastDayCount,
    );

    const plan =
      this.forecastPlans.get(place?.id ?? -1) ??
      Array.from({ length: dayCount }, () => this.defaultProfileKey);

    const days: DailyWeather[] = Array.from({ length: dayCount }, (_, i) =>
      getProfile(plan[i] ?? this.defaultProfileKey).daily,
    );

    const start = new Date(`${this.firstForecastDate}T00:00:00Z`);
    const time = days.map((_, i) => isoDate(new Date(start.getTime() + i * 86_400_000)));

    const column = <K extends keyof DailyWeather>(key: K): DailyWeather[K][] =>
      days.map((d) => d[key]);

    return {
      latitude,
      longitude,
      generationtime_ms: 0.18,
      utc_offset_seconds: 0,
      timezone: place?.timezone ?? 'GMT',
      timezone_abbreviation: 'GMT',
      elevation: 25,
      daily_units: {
        time: 'iso8601',
        weather_code: 'wmo code',
        temperature_2m_max: '°C',
        temperature_2m_min: '°C',
        apparent_temperature_max: '°C',
        precipitation_sum: 'mm',
        precipitation_probability_max: '%',
        snowfall_sum: 'cm',
        wind_speed_10m_max: 'km/h',
        wind_gusts_10m_max: 'km/h',
        sunshine_duration: 's',
      },
      daily: {
        time,
        weather_code: column('weather_code'),
        temperature_2m_max: column('temperature_2m_max'),
        temperature_2m_min: column('temperature_2m_min'),
        apparent_temperature_max: column('apparent_temperature_max'),
        precipitation_sum: column('precipitation_sum'),
        precipitation_probability_max: column('precipitation_probability_max'),
        snowfall_sum: column('snowfall_sum'),
        wind_speed_10m_max: column('wind_speed_10m_max'),
        wind_gusts_10m_max: column('wind_gusts_10m_max'),
        sunshine_duration: column('sunshine_duration'),
      },
    };
  }

  private nearestPlace(latitude: number, longitude: number): GeoPlace | undefined {
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return undefined;
    let best: GeoPlace | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const place of this.places) {
      const distance = Math.hypot(place.latitude - latitude, place.longitude - longitude);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = place;
      }
    }
    // Beyond ~0.5 degrees we are not looking at a place we know about.
    return bestDistance <= 0.5 ? best : undefined;
  }
}

export const fakeOpenMeteo = new FakeOpenMeteo();
