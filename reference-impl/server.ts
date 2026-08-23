/**
 * A conforming implementation of the Activity Ranking API.
 *
 * Not the deliverable - the specification in `features/` is. This exists so
 * that specification can be proved satisfiable rather than merely asserted to
 * be: `npm run demo:green` starts it, points it at the suite's own Open-Meteo
 * double and runs every scenario against it.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { UpstreamError, findPlacesNamed, getForecast, getPlace, searchPlaces, type Place } from './open-meteo';
import { MUTATIONS, activeMutations, mutated } from './mutations';
import { rankDay } from './scoring';
import { terrainAt } from './terrain';

const PORT = Number.parseInt(process.env['PORT'] ?? '3000', 10);

const MAX_LIMIT = 20;
const MAX_DAYS = 7;
const MIN_QUERY_LENGTH = 2;

type ErrorCode =
  | 'INVALID_QUERY' | 'MISSING_LOCATION' | 'CONFLICTING_LOCATION_PARAMS' | 'INVALID_DAYS'
  | 'LOCATION_NOT_FOUND' | 'AMBIGUOUS_LOCATION'
  | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_TIMEOUT';

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** One envelope for every failure, so the front end needs one handler. */
function sendError(res: ServerResponse, error: ApiError): void {
  send(res, error.status, {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  }, error.headers);
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  // CORS is set once per request in `route`, from the request itself, and
  // merged in by writeHead - a single origin is not knowable from here.
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

/**
 * A repeated parameter means the caller is confused about its own request.
 * Silently taking the first is how a front-end bug reaches production.
 */
function single(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1) {
    throw new ApiError(
      400,
      'INVALID_QUERY',
      `The "${name}" parameter was supplied ${values.length} times; supply it once.`,
    );
  }
  return values[0];
}

function integerParam(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
  code: ErrorCode,
): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new ApiError(400, code, `"${name}" must be a whole number between ${min} and ${max}, got "${raw}".`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) {
    if (code === 'INVALID_DAYS' && mutated('no_days_validation')) {
      return Math.max(min, Math.min(max, value));
    }
    throw new ApiError(400, code, `"${name}" must be between ${min} and ${max}, got ${value}.`);
  }
  return value;
}

function upstreamToApiError(error: UpstreamError): ApiError {
  if (error.kind === 'timeout') {
    return new ApiError(504, 'UPSTREAM_TIMEOUT', 'The weather service did not respond in time. Please try again.');
  }
  if (error.kind === 'rate_limited') {
    if (mutated('rate_limit_as_502')) {
      return new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The weather service is unavailable.');
    }
    return new ApiError(
      503,
      'UPSTREAM_RATE_LIMITED',
      'The weather service is rate limiting us. Please try again shortly.',
      undefined,
      { 'retry-after': error.retryAfter ?? '60' },
    );
  }
  return new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'The weather service is unavailable. Please try again shortly.');
}

// --- /v1/locations ----------------------------------------------------------

interface Handled {
  body: unknown;
  headers: Record<string, string>;
}

async function handleLocations(params: URLSearchParams): Promise<Handled> {
  const q = single(params, 'q');
  if (q === undefined || q.trim().length < MIN_QUERY_LENGTH) {
    throw new ApiError(
      400,
      'INVALID_QUERY',
      `"q" must be at least ${MIN_QUERY_LENGTH} characters long.`,
    );
  }

  const limit = integerParam(single(params, 'limit'), 'limit', 10, 1, MAX_LIMIT, 'INVALID_QUERY');
  const results = await searchPlaces(q.trim(), limit);

  return {
    // A typeahead fires a request per keystroke and the answers come back out
    // of order; echoing the query is what lets the front end drop stale ones.
    body: { query: q, count: results.length, results },
    headers: { 'cache-control': 'public, max-age=300' },
  };
}

// --- /v1/rankings -----------------------------------------------------------

async function resolveLocation(params: URLSearchParams): Promise<Place> {
  const locationId = single(params, 'locationId');
  const city = single(params, 'city');

  if (locationId !== undefined && city !== undefined) {
    throw new ApiError(
      400,
      'CONFLICTING_LOCATION_PARAMS',
      'Supply either "locationId" or "city", not both.',
    );
  }

  if (locationId !== undefined) {
    if (locationId.trim() === '') {
      throw new ApiError(400, 'INVALID_QUERY', '"locationId" must not be empty.');
    }
    const place = await getPlace(locationId.trim());
    if (!place) {
      throw new ApiError(404, 'LOCATION_NOT_FOUND', `No location with the id "${locationId}".`);
    }
    return place;
  }

  if (city !== undefined) {
    if (city.trim().length < MIN_QUERY_LENGTH) {
      throw new ApiError(
        400,
        'INVALID_QUERY',
        `"city" must be at least ${MIN_QUERY_LENGTH} characters long.`,
      );
    }
    // Exact name, not prefix: partial names are what /v1/locations is for.
    const matches = await findPlacesNamed(city.trim());
    if (matches.length === 0) {
      throw new ApiError(
        404,
        'LOCATION_NOT_FOUND',
        `No city or town is named "${city}". Search /v1/locations for a partial name.`,
      );
    }
    if (matches.length === 1 || mutated('resolve_ambiguous_silently')) return matches[0]!;
    // Guessing would eventually rank Ontario's weather for someone standing in
    // England. The candidates come back so a picker needs no second round trip.
    throw new ApiError(
      409,
      'AMBIGUOUS_LOCATION',
      `"${city}" matches ${matches.length} places. Choose one and retry with its locationId.`,
      { matches },
    );
  }

  throw new ApiError(400, 'MISSING_LOCATION', 'Supply either "locationId" or "city".');
}

async function handleRankings(params: URLSearchParams): Promise<Handled> {
  const days = integerParam(single(params, 'days'), 'days', MAX_DAYS, 1, MAX_DAYS, 'INVALID_DAYS');
  const place = await resolveLocation(params);
  const forecast = await getForecast(place, days);
  // A property of the place, so it is resolved once rather than per day.
  const terrain = terrainAt(place.latitude, place.longitude);

  return {
    headers: { 'cache-control': 'public, max-age=900' },
    body: {
      location: place,
      generatedAt: new Date().toISOString(),
      forecast: {
        source: 'open-meteo',
        timezone: forecast.timezone,
        days: forecast.days.length,
      },
      units: { temperature: '°C', precipitation: 'mm', snowfall: 'cm', windSpeed: 'km/h' },
      days: forecast.days.map((day) => ({ date: day.date, activities: rankDay(day, terrain) })),
    },
  };
}

// --- routing ----------------------------------------------------------------

/**
 * The API is public, read-only and carries no credentials, so `*` is the
 * honest answer: the same response suits every caller and a shared cache in
 * front of it needs nothing else.
 *
 * The mutation is the other implementation people reach for - echo whatever
 * the caller sent - written the way it is usually written, without the
 * `Vary: Origin` that makes it safe to cache.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  res.setHeader(
    'access-control-allow-origin',
    mutated('echo_origin_without_vary') && typeof origin === 'string' ? origin : '*',
  );
  res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'accept, content-type');
  res.setHeader('access-control-max-age', '86400');
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    send(res, 200, { status: 'ok' });
    return;
  }

  try {
    const handler =
      url.pathname === '/v1/locations' ? handleLocations
      : url.pathname === '/v1/rankings' ? handleRankings
      : undefined;

    if (handler) {
      const { body, headers } = await handler(url.searchParams);
      send(res, 200, body, headers);
      return;
    }
  } catch (error) {
    if (error instanceof ApiError) return sendError(res, error);
    if (error instanceof UpstreamError) return sendError(res, upstreamToApiError(error));
    // Nothing else should reach here; if it does the user still gets JSON.
    process.stderr.write(`Unhandled error: ${String(error)}\n`);
    return sendError(res, new ApiError(502, 'UPSTREAM_UNAVAILABLE', 'Something went wrong upstream.'));
  }

  // Routing errors are outside the documented error contract, which only
  // covers the two endpoints.
  send(res, 404, { error: { code: 'NOT_FOUND', message: `No route for ${url.pathname}.` } });
}

const server = createServer((req, res) => {
  void route(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  const active = activeMutations();
  process.stdout.write(
    `Activity Ranking API (reference implementation) on http://127.0.0.1:${PORT}\n` +
      (active.length > 0
        ? active.map((m) => `  MUTATION ACTIVE: ${m} - ${MUTATIONS[m]}\n`).join('')
        : ''),
  );
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
