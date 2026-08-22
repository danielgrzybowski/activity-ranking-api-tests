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
 *
 * Where a scenario claims a single driver decides the verdict, the profiles it
 * compares differ in that driver alone. ALPINE_POWDER_DAY / LIGHT_SNOW_DAY /
 * COLD_DRY_DAY vary the snowfall at a near-constant temperature and wind, and
 * COLD_CLEAN_SWELL_DAY holds the surfing wind at its ideal while dropping the
 * air below freezing. A scenario whose fixtures move two variables at once
 * cannot tell which one the implementation actually read.
 */

/**
 * Exactly the daily variables the ranking model reads - no more. A fixture
 * field nothing consumes reads as meaningful and is not, and it drifts out of
 * step with what the API actually asks Open-Meteo for.
 */
export interface DailyWeather {
  /** WMO weather interpretation code. */
  weather_code: number;
  temperature_2m_max: number;
  precipitation_sum: number;
  snowfall_sum: number;
  wind_speed_10m_max: number;
  wind_gusts_10m_max: number;
  sunshine_duration: number;
}

export interface WeatherProfile {
  key: string;
  /**
   * Plain-English summary of the numbers below, so a reader can check the
   * fixture really does justify the verdict the Gherkin asks for. Echoed when
   * a step names a profile that does not exist.
   */
  description: string;
  daily: DailyWeather;
}

const hours = (h: number): number => Math.round(h * 3600);

const PROFILE_LIST: WeatherProfile[] = [
  {
    key: 'ALPINE_POWDER_DAY',
    description: '25cm of fresh snow at -4C, light winds',
    daily: {
      weather_code: 75,
      temperature_2m_max: -4,
      precipitation_sum: 18.2,
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
      precipitation_sum: 29.0,
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
      precipitation_sum: 6.4,
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
      precipitation_sum: 0.4,
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
      precipitation_sum: 0,
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
      precipitation_sum: 30.5,
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
      precipitation_sum: 0,
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
      precipitation_sum: 18.0,
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
      precipitation_sum: 1.2,
      snowfall_sum: 0,
      wind_speed_10m_max: 14,
      wind_gusts_10m_max: 25,
      sunshine_duration: hours(1.5),
    },
  },
  {
    key: 'HEATWAVE_DAY',
    description: '39C and cloudless - too hot to walk a city all day',
    daily: {
      weather_code: 0,
      temperature_2m_max: 39,
      precipitation_sum: 0,
      snowfall_sum: 0,
      wind_speed_10m_max: 6,
      wind_gusts_10m_max: 12,
      sunshine_duration: hours(13),
    },
  },
  {
    key: 'COLD_CLEAN_SWELL_DAY',
    description: '-2C with an ideal 24 km/h wind - the wind is right, the air is not',
    daily: {
      weather_code: 1,
      temperature_2m_max: -2,
      precipitation_sum: 0.2,
      snowfall_sum: 0,
      wind_speed_10m_max: 24,
      wind_gusts_10m_max: 33,
      sunshine_duration: hours(6),
    },
  },
  {
    key: 'LIGHT_SNOW_DAY',
    description: '6cm of new snow, -3C, light winds - the middle of the snowfall range',
    daily: {
      weather_code: 73,
      temperature_2m_max: -3,
      precipitation_sum: 5.0,
      snowfall_sum: 6,
      wind_speed_10m_max: 12,
      wind_gusts_10m_max: 24,
      sunshine_duration: hours(3),
    },
  },
  {
    key: 'COLD_DRY_DAY',
    description: 'No new snow, -3C, light winds - identical to LIGHT_SNOW_DAY but for the snowfall',
    daily: {
      weather_code: 1,
      temperature_2m_max: -3,
      precipitation_sum: 0,
      snowfall_sum: 0,
      wind_speed_10m_max: 10,
      wind_gusts_10m_max: 20,
      sunshine_duration: hours(6),
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
    const known = [...WEATHER_PROFILES.values()]
      .map((p) => `\n  ${p.key} - ${p.description}`)
      .join('');
    throw new Error(`Unknown weather profile "${key}". Known profiles:${known}`);
  }
  return profile;
}
