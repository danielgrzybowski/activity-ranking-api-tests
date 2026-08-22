/**
 * Breaks the reference implementation on purpose, one defect at a time, and
 * reports whether the suite notices.
 *
 *   npm run mutation-run
 *
 * `demo:green` proves the specification is satisfiable. It does not prove the
 * assertions are load-bearing - a suite of `expect(true)` would also be green.
 * This is the other half: for each mutation in `reference-impl/mutations.ts`,
 * how many scenarios turn red.
 *
 * A mutation nothing catches is reported rather than hidden. Some are
 * genuinely equivalent - the implementation never reaches the mutated branch -
 * and others are a real gap; the useful thing is knowing which.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { MUTATIONS, type Mutation } from '../reference-impl/mutations';

/** Runs the whole suite against the implementation, and counts what failed. */
function scenariosFailing(mutations: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/demo-green.ts'], {
      stdio: 'ignore',
      env: { ...process.env, MUTATIONS: mutations },
    });
    child.on('error', reject);
    child.on('exit', async () => {
      try {
        const report = JSON.parse(await readFile('reports/results.json', 'utf8'));
        resolve((report.stats?.unexpected ?? 0) + (report.stats?.flaky ?? 0));
      } catch (error) {
        reject(error);
      }
    });
  });
}

process.stdout.write('Baseline (no mutations)...\n');
const baseline = await scenariosFailing('');
if (baseline > 0) {
  process.stdout.write(
    `\n${baseline} scenario(s) fail before any mutation is applied. Fix that first:\n` +
      `a mutation run against a red baseline measures nothing.\n`,
  );
  process.exit(1);
}
process.stdout.write('  baseline is green\n\n');

const results: { mutation: Mutation; caught: number }[] = [];
for (const mutation of Object.keys(MUTATIONS) as Mutation[]) {
  process.stdout.write(`Mutating: ${mutation}...`);
  const caught = await scenariosFailing(mutation);
  results.push({ mutation, caught });
  process.stdout.write(caught > 0 ? ` caught by ${caught} scenario(s)\n` : ` NOT CAUGHT\n`);
}

const width = Math.max(...results.map((r) => r.mutation.length));
process.stdout.write('\nMutation results\n================\n');
for (const { mutation, caught } of results) {
  process.stdout.write(`  ${mutation.padEnd(width)}  ${caught > 0 ? `caught - ${caught} scenario(s)` : 'NOT CAUGHT'}\n`);
  process.stdout.write(`  ${' '.repeat(width)}  ${MUTATIONS[mutation]}\n`);
}

const missed = results.filter((r) => r.caught === 0);
process.stdout.write(
  missed.length === 0
    ? `\nAll ${results.length} mutations were caught.\n`
    : `\n${missed.length} of ${results.length} went unnoticed: ${missed.map((m) => m.mutation).join(', ')}.\n` +
        `Either the scenario that should have caught it is missing, or the mutation is equivalent.\n`,
);
