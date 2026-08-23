import { z } from 'zod';
import { ACTIVITIES, ERROR_CODES, RATINGS } from './domain';

/**
 * The response contract, expressed once so every scenario checks the same
 * thing. `.strict()` is deliberate: an undocumented field is a contract
 * change, and a spec-first suite should notice one.
 */

export const LocationSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /**
     * Null where Open-Meteo has no country name for the place. It really does
     * happen: id 11546715 is a London in Guadeloupe filed with a country code
     * and no country. `countryCode` is always there, so a client can still
     * render a flag.
     */
    country: z.string().min(1).nullable(),
    countryCode: z.string().length(2),
    /** Null where Open-Meteo has no region for the place; the API must not invent one. */
    region: z.string().min(1).nullable(),
    latitude: z.number().gte(-90).lte(90),
    longitude: z.number().gte(-180).lte(180),
    timezone: z.string().min(1),
    population: z.number().int().nonnegative().nullable(),
    /** Pre-formatted for a picker, so the front end never has to guess. */
    displayName: z.string().min(1),
  })
  .strict();

export const LocationsResponseSchema = z
  .object({
    query: z.string(),
    count: z.number().int().nonnegative(),
    results: z.array(LocationSchema),
  })
  .strict()
  .refine((r) => r.count === r.results.length, {
    message: 'count must equal results.length',
  });

export const ActivityRankingSchema = z
  .object({
    activity: z.enum(ACTIVITIES),
    /**
     * Whether the place can support this activity at all, answered before the
     * weather is read: surfing needs a coast, skiing needs a ski area.
     *
     * A field rather than something a reader infers from the prose. "Sea
     * breeze, 19°C and clear skies" is a good day at the beach, not a
     * statement that there is no sea, and a contract that made the front end
     * grep the reasoning to tell those apart would be unimplementable.
     */
    feasible: z.boolean(),
    score: z.number().int().min(0).max(100),
    rating: z.enum(RATINGS),
    rank: z.number().int().min(1).max(ACTIVITIES.length),
    reasoning: z.string().min(1),
  })
  .strict();

export const DayRankingSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be an ISO calendar date'),
    activities: z.array(ActivityRankingSchema).length(ACTIVITIES.length),
  })
  .strict();

export const RankingsResponseSchema = z
  .object({
    location: LocationSchema,
    generatedAt: z.string().datetime({ offset: true }),
    forecast: z
      .object({
        source: z.literal('open-meteo'),
        timezone: z.string().min(1),
        days: z.number().int().min(1).max(7),
      })
      .strict(),
    units: z
      .object({
        temperature: z.string().min(1),
        precipitation: z.string().min(1),
        snowfall: z.string().min(1),
        windSpeed: z.string().min(1),
      })
      .strict(),
    days: z.array(DayRankingSchema).min(1).max(7),
  })
  .strict()
  .refine((r) => r.days.length === r.forecast.days, {
    message: 'forecast.days must equal days.length',
  });

export const ErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        message: z.string().min(1),
        details: z.record(z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

/** Returned alongside 409 AMBIGUOUS_LOCATION so a picker can be rendered. */
export const AmbiguousLocationDetailsSchema = z
  .object({
    matches: z.array(LocationSchema).min(2),
  })
  .strict();

export type LocationsResponse = z.infer<typeof LocationsResponseSchema>;
export type RankingsResponse = z.infer<typeof RankingsResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ActivityRanking = z.infer<typeof ActivityRankingSchema>;
export type DayRanking = z.infer<typeof DayRankingSchema>;
