import { defineConfig } from '@playwright/test';
import { defineBddProject } from 'playwright-bdd';
import { config as suiteConfig } from './src/support/config';

const bdd = {
  features: 'features/**/*.feature',
  steps: ['features/step_definitions/**/*.ts', 'src/support/fixtures.ts'],
  // An undefined or mis-arity step is a defect in the suite, not the intended
  // red state, so fail at generation rather than letting it show up as a
  // skipped scenario in the report.
  missingSteps: 'fail-on-gen' as const,
  arityCheck: true,
};

export default defineConfig({
  /**
   * One worker, deliberately.
   *
   * The Open-Meteo double is a single shared, mutable process that the API
   * under test reaches on a fixed port. It cannot be given a per-worker
   * instance without the API under test cooperating, so parallel scenarios
   * would overwrite each other's weather. This is a property of testing a
   * separately-deployed service against a stubbed upstream, not of Playwright:
   * the same constraint applied under Cucumber.
   *
   * The whole suite runs in a few seconds anyway, so there is nothing to buy.
   */
  workers: 1,
  fullyParallel: false,

  timeout: 30_000,
  expect: { timeout: 5_000 },

  forbidOnly: !!process.env['CI'],
  // The suite is red until the API exists; retrying would only slow that down.
  retries: 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
  ],

  use: {
    baseURL: suiteConfig.apiBaseUrl,
    extraHTTPHeaders: { accept: 'application/json' },
    trace: 'retain-on-failure',
  },

  projects: [
    defineBddProject({
      name: 'spec',
      ...bdd,
      // @live hits the real Open-Meteo and is opt-in only.
      tags: 'not @live',
    }),
    defineBddProject({
      name: 'live',
      ...bdd,
      tags: '@live',
    }),
  ],
});
