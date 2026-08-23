import type { GeoPlace } from '../fake-open-meteo';

/**
 * The geocoding catalogue most scenarios start from. Chosen to cover the
 * cases a front end has to survive: three real Londons, an accented name,
 * a ski town, and a surf town.
 *
 * The order here is deliberately *not* population order. The double serves
 * the catalogue in the order it is given, so a scenario that asserts "most
 * prominent first" is asserting something the API has to do rather than
 * something the upstream handed it.
 */
export const DEFAULT_PLACES: GeoPlace[] = [
  {
    id: 4517009,
    name: 'London',
    admin1: 'Ohio',
    country: 'United States',
    country_code: 'US',
    latitude: 39.88645,
    longitude: -83.44825,
    timezone: 'America/New_York',
    population: 10060,
  },
  {
    id: 6058560,
    name: 'London',
    admin1: 'Ontario',
    country: 'Canada',
    country_code: 'CA',
    latitude: 42.98339,
    longitude: -81.23304,
    timezone: 'America/Toronto',
    population: 346765,
  },
  {
    id: 2643743,
    name: 'London',
    admin1: 'England',
    country: 'United Kingdom',
    country_code: 'GB',
    latitude: 51.50853,
    longitude: -0.12574,
    timezone: 'Europe/London',
    population: 8961989,
  },
  {
    id: 2657928,
    name: 'Zermatt',
    admin1: 'Valais',
    country: 'Switzerland',
    country_code: 'CH',
    latitude: 46.01998,
    longitude: 7.74863,
    timezone: 'Europe/Zurich',
    population: 6629,
  },
  {
    // The same name, region and country as the village above, because
    // Open-Meteo really does carry it that way. Filtering it out is the only
    // thing that keeps the two apart in a picker.
    id: 11862393,
    name: 'Zermatt',
    admin1: 'Valais',
    country: 'Switzerland',
    country_code: 'CH',
    latitude: 46.02928,
    longitude: 7.7533,
    timezone: 'Europe/Zurich',
    population: null,
    feature_code: 'AIRH',
  },
  {
    id: 2988507,
    name: 'Paris',
    admin1: 'Ile-de-France',
    country: 'France',
    country_code: 'FR',
    latitude: 48.85341,
    longitude: 2.3488,
    timezone: 'Europe/Paris',
    population: 2138551,
  },
  {
    id: 2657896,
    name: 'Zurich',
    admin1: 'Canton of Zurich',
    country: 'Switzerland',
    country_code: 'CH',
    latitude: 47.36667,
    longitude: 8.55,
    timezone: 'Europe/Zurich',
    population: 341730,
  },
  {
    id: 3027301,
    name: 'Chamonix',
    admin1: 'Rhône-Alpes',
    country: 'France',
    country_code: 'FR',
    latitude: 45.92375,
    longitude: 6.86933,
    timezone: 'Europe/Paris',
    population: 8611,
  },
  {
    id: 2654380,
    name: 'Bude',
    admin1: 'England',
    country: 'United Kingdom',
    country_code: 'GB',
    latitude: 50.82624,
    longitude: -4.54376,
    timezone: 'Europe/London',
    population: 9222,
  },
];
