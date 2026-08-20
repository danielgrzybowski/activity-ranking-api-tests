export interface SuiteConfig {
  /** Base URL of the API under test. */
  apiBaseUrl: string;
  /** Port the Open-Meteo test double binds to. */
  fakeUpstreamPort: number;
  /** Per-request timeout applied by the suite itself. */
  apiTimeoutMs: number;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`);
  return parsed;
}

export const config: SuiteConfig = {
  apiBaseUrl: (process.env['API_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, ''),
  fakeUpstreamPort: int('FAKE_OPEN_METEO_PORT', 8787),
  apiTimeoutMs: int('API_TIMEOUT_MS', 5000),
};
