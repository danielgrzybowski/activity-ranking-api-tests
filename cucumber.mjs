const common = {
  import: ['src/support/**/*.ts', 'features/step_definitions/**/*.ts'],
  format: ['summary', 'progress-bar', 'html:reports/cucumber-report.html', 'json:reports/cucumber-report.json'],
  formatOptions: { snippetInterface: 'async-await' },
  strict: true,
};

export default {
  ...common,
  // @live hits the real Open-Meteo service and is opt-in only.
  tags: 'not @live',
};

// Runs the same specs against the real Open-Meteo API: `npm run test:live`.
export const live = {
  ...common,
  tags: '@live',
};
