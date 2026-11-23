import { defineConfig, devices } from '@playwright/test';

import { E2E_ANON_KEY, E2E_SUPABASE_URL } from './tests/e2e/mockSupabase';

/**
 * E2E smoke tests run against the static web export (`expo export -p web`), the same artifact that is deployed,
 * exported to dist-e2e/ so the deployable dist/ is never replaced by the mock build, and pointed at a mock Supabase URL that the tests answer
 * (tests/e2e/mockSupabase.ts), so no live backend or photo API is needed. Unit tests (`*.test.mjs`) live outside tests/e2e
 * and run under `node --test` via `npm run test:unit`.
 * See https://playwright.dev/docs/test-configuration.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx expo export -p web --output-dir dist-e2e && node tests/e2e/serve-dist.mjs`,
    url: `http://localhost:${PORT}`,
    // Process env wins over .env, so the export always targets the mock backend.
    env: { PORT: String(PORT), EXPO_PUBLIC_SUPABASE_URL: E2E_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: E2E_ANON_KEY },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
