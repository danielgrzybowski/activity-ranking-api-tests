/**
 * Checks every Open-Meteo place id the suite pins against the live catalogue.
 *
 *   npm run verify-fixtures
 *
 * The double serves whatever the fixture says, so a made-up place is invisible
 * to every other check here: the suite is green, `demo:green` is green, and the
 * mutation run is 12/12, all of them agreeing about a town that does not exist.
 * Four got in that way, and the pattern is worth stating - every one of them is
 * a value that looks right:
 *
 *   6299351  pinned as "London Heliport, England" - it is Alcantarilla Air
 *            Base, in Murcia
 *   2657896  spelled "Zürich", when the English catalogue this API asks for
 *            says "Zurich"
 *    982299  coordinates 137 km from the London in Mpumalanga they name
 *   2265552  Nazaré, pinned as having no region, which is the entire premise
 *            of the scenario built on it. It has one: "Leiria District"
 *
 * The first two were found by hand. The other two this script found on its
 * first run, which is the argument for having it.
 *
 * Most rows live in data tables inside `.feature` files - the one place a
 * value can be typed from memory and nothing downstream ever disagrees - so
 * this reads those as well as `places.ts`.
 *
 * **What fails and what only warns.** A drift check that goes red when
 * somebody restates a region name is a drift check nobody reruns, which is the
 * same reason `@live` asserts the contract and not the catalogue. So the
 * identity of the place is an error - a missing id, a different name, moved
 * coordinates, a settlement that turns out to be an airfield - and everything
 * Open-Meteo is entitled to restate is a warning: region, country, timezone,
 * population. London, Ontario has gained 75,000 people since these fixtures
 * were written. That is not a defect in the fixture.
 *
 * It costs one upstream call per pinned id - twenty-six today - so it belongs
 * on a schedule next to `npm run test:live`, not in CI.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PLACES } from '../src/support/fixtures/places';

const GEOCODING_BASE = 'https://geocoding-api.open-meteo.com';
const FEATURES_DIR = 'features';

/**
 * The suite compares forecast coordinates at 0.01 degrees, so a fixture that
 * passes here cannot fail that assertion for having drifted.
 */
const COORDINATE_TOLERANCE = 0.01;

/**
 * `undefined` means the fixture does not speak to that field - the column is
 * not in this table. `null` means it does: the cell is blank, so the fixture
 * is asserting that Open-Meteo has no value here. The two are checked
 * differently, because a constructed gap the live catalogue does not have
 * makes the scenario built on it fiction.
 */
interface Pinned {
  id: string;
  name: string;
  region?: string | null | undefined;
  country?: string | null | undefined;
  timezone?: string | null | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  population?: number | null | undefined;
  featureCode?: string | undefined;
  where: string;
}

interface LivePlace {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  admin1?: string;
  country?: string;
  population?: number;
  feature_code?: string;
}

// --- where the pinned ids live ----------------------------------------------

const fromFixtures = (): Pinned[] =>
  DEFAULT_PLACES.map((place) => ({
    id: String(place.id),
    name: place.name,
    region: place.admin1 ?? null,
    country: place.country ?? null,
    timezone: place.timezone,
    latitude: place.latitude,
    longitude: place.longitude,
    population: place.population,
    featureCode: place.feature_code,
    where: 'places.ts',
  }));

/**
 * Gherkin data tables, read by their header row rather than by shape.
 *
 * A block of `|` lines is a place catalogue only if its header names both `id`
 * and `name`; that is what keeps `| day | profile |` and the Examples tables
 * out. Reading the header is also what makes the columns optional - not every
 * catalogue in the suite carries a timezone or a population.
 */
function fromFeatureFiles(): Pinned[] {
  const pinned: Pinned[] = [];

  for (const file of readdirSync(FEATURES_DIR).filter((f) => f.endsWith('.feature'))) {
    const lines = readFileSync(join(FEATURES_DIR, file), 'utf8').split('\n');
    let header: string[] | undefined;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) {
        header = undefined;
        return;
      }

      const cells = trimmed
        .slice(1, trimmed.lastIndexOf('|'))
        .split('|')
        .map((cell) => cell.trim());

      if (!header) {
        header = cells;
        return;
      }
      if (!header.includes('id') || !header.includes('name')) return;

      const cell = (column: string): string | null | undefined => {
        const at = header!.indexOf(column);
        if (at === -1) return undefined;
        const value = cells[at] ?? '';
        return value === '' ? null : value;
      };

      const id = cell('id');
      const name = cell('name');
      if (!id || !name) return;

      const latitude = cell('latitude');
      const longitude = cell('longitude');
      const population = cell('population');
      const featureCode = cell('featureCode');

      pinned.push({
        id,
        name,
        region: cell('region'),
        country: cell('country'),
        timezone: cell('timezone'),
        latitude: latitude ? Number.parseFloat(latitude) : undefined,
        longitude: longitude ? Number.parseFloat(longitude) : undefined,
        population:
          population === undefined ? undefined : population === null ? null : Number.parseInt(population, 10),
        featureCode: featureCode ?? undefined,
        where: `${file}:${index + 1}`,
      });
    });
  }

  return pinned;
}

// --- the live catalogue ------------------------------------------------------

class NotFound extends Error {}

async function lookup(id: string): Promise<LivePlace> {
  // `language=en` because that is what the API under test asks for. Get this
  // wrong and the check green-lights a German spelling the API never sees.
  const response = await fetch(`${GEOCODING_BASE}/v1/get?id=${id}&language=en&format=json`);
  if (response.status === 404) {
    await response.text();
    throw new NotFound(`Open-Meteo has no place with the id ${id}`);
  }
  if (!response.ok) {
    throw new Error(`Open-Meteo answered ${response.status} for id ${id}`);
  }
  return (await response.json()) as LivePlace;
}

/** `PPL*` is a populated place; anything else is an airfield, a peak, a lake. */
const isSettlement = (featureCode: string | undefined): boolean =>
  featureCode === undefined || featureCode.startsWith('PPL');

function compare(pinned: Pinned, live: LivePlace): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const differs = (what: string, ours: unknown, theirs: unknown): string =>
    `${what}: fixture ${JSON.stringify(ours ?? null)}, live ${JSON.stringify(theirs ?? null)}`;

  if (pinned.name !== live.name) errors.push(differs('name', pinned.name, live.name));

  for (const [axis, ours, theirs] of [
    ['latitude', pinned.latitude, live.latitude],
    ['longitude', pinned.longitude, live.longitude],
  ] as const) {
    if (ours !== undefined && Math.abs(ours - theirs) > COORDINATE_TOLERANCE) {
      errors.push(differs(axis, ours, theirs));
    }
  }

  // The suite's airfield scenarios depend on this being genuinely an airfield,
  // and the ranking scenarios on their towns being genuinely towns.
  if (isSettlement(pinned.featureCode) !== isSettlement(live.feature_code)) {
    errors.push(
      differs('feature code', pinned.featureCode ?? 'PPL (implied)', live.feature_code) +
        ` - one of these is a settlement and the other is not`,
    );
  }

  // Everything Open-Meteo may restate without the fixture being wrong - plus
  // the gaps. A fixture cell left blank is a claim that the live catalogue has
  // nothing there, and the scenarios about missing regions, populations and
  // countries are only worth having if that claim is true.
  const restated = (
    what: string,
    ours: string | number | null | undefined,
    theirs: string | number | undefined,
  ): void => {
    if (ours === undefined) return;
    if (ours === null && theirs !== undefined) {
      warnings.push(`${what}: fixture says Open-Meteo has none, live has ${JSON.stringify(theirs)}`);
      return;
    }
    if (ours !== null && ours !== theirs) warnings.push(differs(what, ours, theirs));
  };

  restated('region', pinned.region, live.admin1);
  restated('country', pinned.country, live.country);
  restated('timezone', pinned.timezone, live.timezone);
  restated('population', pinned.population, live.population);

  return { errors, warnings };
}

// --- run ---------------------------------------------------------------------

const pinned = [...fromFixtures(), ...fromFeatureFiles()];
process.stdout.write(
  `Checking ${pinned.length} pinned Open-Meteo ids against the live catalogue\n` +
    `  (${GEOCODING_BASE}, language=en - one call each)\n\n`,
);

let wrong = 0;
let drifting = 0;

for (const place of pinned) {
  const label = `${place.id.padStart(9)}  ${place.name.padEnd(18)} ${place.where}`;
  let live: LivePlace;

  try {
    live = await lookup(place.id);
  } catch (error) {
    if (error instanceof NotFound) {
      wrong += 1;
      process.stdout.write(`  FAIL  ${label}\n          ${error.message}\n`);
      continue;
    }
    // Open-Meteo being unreachable is not a defect in the fixtures, and
    // reporting it as one would send somebody looking in the wrong file.
    process.stdout.write(
      `\nCould not reach Open-Meteo: ${error instanceof Error ? error.message : String(error)}\n` +
        `Nothing is proven either way about the fixtures; try again when it answers.\n`,
    );
    process.exit(2);
  }

  const { errors, warnings } = compare(place, live);
  const status = errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'WARN' : 'OK  ';
  process.stdout.write(`  ${status}  ${label}\n`);
  for (const line of [...errors, ...warnings]) process.stdout.write(`          ${line}\n`);

  if (errors.length > 0) wrong += 1;
  else if (warnings.length > 0) drifting += 1;
}

const summary =
  `\n${pinned.length} ids checked - ${pinned.length - wrong - drifting} exact, ` +
  `${drifting} with drift Open-Meteo is entitled to, ${wrong} wrong.\n`;

process.stdout.write(
  wrong === 0
    ? `${summary}Every pinned id is the place the fixture says it is.\n`
    : `${summary}A wrong id is invisible to every other check here: the double serves whatever the\n` +
        `fixture says, so the suite stays green while describing a place that does not exist.\n`,
);

process.exit(wrong === 0 ? 0 : 1);
