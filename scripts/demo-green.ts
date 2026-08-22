/**
 * Runs the suite against the reference implementation, so there is something
 * to run it against.
 *
 *   npm run demo:green   the spec scenarios, upstream stubbed by the double
 *   npm run demo:live    the @live scenarios, against the real Open-Meteo
 *
 * A suite that has only ever been red is a suite whose assertions nobody has
 * checked. `demo:green` is how they get checked: every scenario, over real
 * HTTP, with the Open-Meteo double standing in for the upstream.
 *
 * `demo:live` is the drift check, so it deliberately does *not* stub the
 * upstream - an API still talking to the double would prove nothing about
 * whether the double has drifted from the real payloads.
 *
 * `npm test` and `npm run test:live` stay pointed at API_BASE_URL, whatever is
 * listening there. These two are a convenience for when that is nothing.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { config } from '../src/support/config';

const run = (command: string, args: string[]): Promise<number> =>
  new Promise((resolve) => {
    spawn(command, args, { stdio: 'inherit' }).on('exit', (code) => resolve(code ?? 1));
  });

const live = process.argv.includes('--live');

async function startApi(): Promise<ChildProcess> {
  const child = spawn('npx', ['tsx', 'reference-impl/server.ts'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      PORT: new URL(config.apiBaseUrl).port || '3000',
      // Left unset for --live: the reference implementation then falls back to
      // the real Open-Meteo, which is the whole point of the drift check.
      ...(live
        ? {}
        : {
            // The suite starts its own double on this port, per worker.
            OPEN_METEO_GEOCODING_BASE_URL: `http://127.0.0.1:${config.fakeUpstreamPort}/geocoding`,
            OPEN_METEO_FORECAST_BASE_URL: `http://127.0.0.1:${config.fakeUpstreamPort}/forecast`,
          }),
    },
  });
  child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`  [api] ${chunk}`));

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${config.apiBaseUrl}/health`);
      await response.text();
      if (response.ok) return child;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The reference implementation never became healthy on ${config.apiBaseUrl}.`);
}

const api = await startApi();
try {
  const generated = await run('npx', ['bddgen']);
  const project = live ? '--project=live' : '--project=spec';
  process.exitCode = generated !== 0 ? generated : await run('npx', ['playwright', 'test', project]);
} finally {
  api.kill('SIGTERM');
}
