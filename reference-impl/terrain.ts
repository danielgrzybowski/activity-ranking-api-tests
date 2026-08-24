/**
 * Can this activity be done here at all?
 *
 * Every activity asks two questions; the scoring model answers the second.
 * This answers the first, and it has to come first: 14 km/h of wind over
 * Chamonix is not "marginal surf", it is 250km from the nearest sea.
 *
 * The reference points below are an ILLUSTRATIVE dataset sized to the places
 * the suite exercises. Production needs a real one - coastline geometry and a
 * ski-area registry - or, for the coast half, Open-Meteo's Marine API, which
 * errors on inland coordinates and so answers the question as a side effect.
 * The specification pins the behaviour and leaves the data source open.
 */

export interface Terrain {
  hasCoast: boolean;
  hasSkiArea: boolean;
}

/** A surf beach is a day out; a ski area is worth an hour in the car. */
const COAST_RADIUS_KM = 25;
const SKI_RADIUS_KM = 50;

const COASTLINE: ReadonlyArray<[number, number]> = [
  [50.826, -4.554], [50.415, -5.1], [51.54, 0.71], // England
  [39.601, -9.07], [39.356, -9.381], // Portugal
  [43.483, -1.559], [49.494, 0.107], [43.696, 7.266], // France
  [44.407, 8.934], [52.106, 4.275], [54.9, 8.32], // Italy, Netherlands, Germany
  [36.962, -122.021], [41.036, -71.945], // United States
  [68.438, 17.427], // Narvik, on Ofotfjord
];

const SKI_AREAS: ReadonlyArray<[number, number]> = [
  [45.924, 6.869], [45.448, 6.98], // Chamonix, Val d'Isere
  [46.021, 7.749], [47.092, 9.283], // Zermatt, Flumserberg
  [47.446, 12.392], // Kitzbuhel
  [50.116, -122.955], [39.188, -106.818], // Whistler, Aspen
  [68.439, 17.449], // Narvikfjellet, a kilometre above the fjord
];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const nearestKm = (lat: number, lon: number, points: ReadonlyArray<[number, number]>): number =>
  Math.min(...points.map(([pLat, pLon]) => distanceKm(lat, lon, pLat, pLon)));

export const terrainAt = (latitude: number, longitude: number): Terrain => ({
  hasCoast: nearestKm(latitude, longitude, COASTLINE) <= COAST_RADIUS_KM,
  hasSkiArea: nearestKm(latitude, longitude, SKI_AREAS) <= SKI_RADIUS_KM,
});
