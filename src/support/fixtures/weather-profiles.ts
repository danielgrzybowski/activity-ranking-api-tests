/**
 * Canonical weather days used by the specs.
 *
 * Each profile is a set of Open-Meteo daily values, deliberately unambiguous:
 * a human reading the numbers should reach the same verdict the Gherkin asks
 * the API for. Values are in Open-Meteo's default units --
 * temperature in C, precipitation in mm, snowfall in cm, wind in km/h,
 * sunshine_duration in seconds.
 *
 * Fixtures are inputs only. Expected outcomes live in the feature files,
 * because the expectations are the specification.
 */

export interface DailyWeather {
  /** WMO weather interpretation code. */
  weather_code: number;
  temperature_2m_max: number;
  temperature_2m_min: number;
  apparent_temperature_max: number;
  precipitation_sum: number;
  precipitation_probability_max: number;
  snowfall_sum: number;
  wind_speed_10m_max: number;
  wind_gusts_10m_max: number;
  sunshine_duration: number;
}

export interface WeatherProfile {
  key: string;
  /** Plain-English summary, echoed in failure messages to aid triage. */
  description: string;
  daily: DailyWeather;
}

const hours = (h: number): number => Math.round(h * 3600);

const PROFILE_LIST: WeatherProfile[] = [
  {
    key: 'ALPINE_POWDER_DAY',
    description: '25cm of fresh snow, -4C, light winds',
    daily: {
      weather_code: 75,
      temperature_2m_max: -4,
      temperature_2m_min: -11,
      apparent_temperature_max: -9,
      precipitation_sum: 18.2,
      precipitation_probability_max: 95,
      snowfall_sum: 25,
      wind_speed_10m_max: 11,
      wind_gusts_10m_max: 22,
      sunshine_duration: hours(2.5),
    },
  },
  {
    key: 'BLIZZARD',
    description: '40cm of snow but 95 km/h gusts - lifts would be on wind hold',
    daily: {
      weather_code: 75,
      temperature_2m_max: -12,
      temperature_2m_min: -19,
      apparent_temperature_max: -24,
      precipitation_sum: 29.0,
      precipitation_probability_max: 100,
      snowfall_sum: 40,
      wind_speed_10m_max: 64,
      wind_gusts_10m_max: 95,
      sunshine_duration: hours(0),
    },
  },
  {
    key: 'SPRING_SLUSH_DAY',
    description: 'Old snow, no fresh fall, +9C and raining on the piste',
    daily: {
      weather_code: 61,
      temperature_2m_max: 9,
      temperature_2m_min: 3,
      apparent_temperature_max: 7,
      precipitation_sum: 6.4,
      precipitation_probability_max: 80,
      snowfall_sum: 0,
      wind_speed_10m_max: 18,
      wind_gusts_10m_max: 31,
      sunshine_duration: hours(1),
    },
  },
  {
    key: 'CLEAN_SWELL_DAY',
    description: '21C, steady 24 km/h wind - workable surf',
    daily: {
      weather_code: 2,
      temperature_2m_max: 21,
      temperature_2m_min: 15,
      apparent_temperature_max: 21,
      precipitation_sum: 0.4,
      precipitation_probability_max: 15,
      snowfall_sum: 0,
      wind_speed_10m_max: 24,
      wind_gusts_10m_max: 33,
      sunshine_duration: hours(8),
    },
  },
  {
    key: 'FLAT_CALM_DAY',
    description: '26C and almost no wind - nothing to surf',
    daily: {
      weather_code: 0,
      temperature_2m_max: 26,
      temperature_2m_min: 17,
      apparent_temperature_max: 26,
      precipitation_sum: 0,
      precipitation_probability_max: 0,
      snowfall_sum: 0,
      wind_speed_10m_max: 3,
      wind_gusts_10m_max: 7,
      sunshine_duration: hours(12),
    },
  },
  {
    key: 'STORM_DAY',
    description: '95 km/h gusts, 30mm of rain - dangerous outdoors and in the water',
    daily: {
      weather_code: 95,
      temperature_2m_max: 14,
      temperature_2m_min: 11,
      apparent_temperature_max: 11,
      precipitation_sum: 30.5,
      precipitation_probability_max: 100,
      snowfall_sum: 0,
      wind_speed_10m_max: 66,
      wind_gusts_10m_max: 95,
      sunshine_duration: hours(0.2),
    },
  },
  {
    key: 'PERFECT_SUMMER_DAY',
    description: '22C, clear skies, no rain, gentle breeze',
    daily: {
      weather_code: 0,
      temperature_2m_max: 22,
      temperature_2m_min: 14,
      apparent_temperature_max: 22,
      precipitation_sum: 0,
      precipitation_probability_max: 3,
      snowfall_sum: 0,
      wind_speed_10m_max: 8,
      wind_gusts_10m_max: 15,
      sunshine_duration: hours(11),
    },
  },
  {
    key: 'COLD_RAIN_DAY',
    description: '4C with 18mm of rain - miserable but not dangerous',
    daily: {
      weather_code: 63,
      temperature_2m_max: 4,
      temperature_2m_min: 1,
      apparent_temperature_max: 0,
      precipitation_sum: 18.0,
      precipitation_probability_max: 95,
      snowfall_sum: 0,
      wind_speed_10m_max: 29,
      wind_gusts_10m_max: 46,
      sunshine_duration: hours(0),
    },
  },
  {
    key: 'MILD_OVERCAST_DAY',
    description: '16C, grey, an occasional shower - a nothing-special day',
    daily: {
      weather_code: 3,
      temperature_2m_max: 16,
      temperature_2m_min: 10,
      apparent_temperature_max: 15,
      precipitation_sum: 1.2,
      precipitation_probability_max: 40,
      snowfall_sum: 0,
      wind_speed_10m_max: 14,
      wind_gusts_10m_max: 25,
      sunshine_duration: hours(1.5),
    },
  },
  {
    key: 'HEATWAVE_DAY',
    description: '39C with no respite overnight - too hot to walk a city all day',
    daily: {
      weather_code: 0,
      temperature_2m_max: 39,
      temperature_2m_min: 27,
      apparent_temperature_max: 43,
      precipitation_sum: 0,
      precipitation_probability_max: 0,
      snowfall_sum: 0,
      wind_speed_10m_max: 6,
      wind_gusts_10m_max: 12,
      sunshine_duration: hours(13),
    },
  },
];

export const WEATHER_PROFILES: ReadonlyMap<string, WeatherProfile> = new Map(
  PROFILE_LIST.map((p) => [p.key, p]),
);

/** Neutral filler so a spec only has to describe the days it cares about. */
export const DEFAULT_PROFILE_KEY = 'MILD_OVERCAST_DAY';

export function getProfile(key: string): WeatherProfile {
  const profile = WEATHER_PROFILES.get(key);
  if (!profile) {
    const known = [...WEATHER_PROFILES.keys()].join(', ');
    throw new Error(`Unknown weather profile "${key}". Known profiles: ${known}`);
  }
  return profile;
}
