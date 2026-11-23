import { defineConfig, devices } from '@playwright/test';

import { E2E_ANON_KEY, E2E_SUPABASE_URL } from './tests/e2e/mockSupabase';

/**
 * Two E2E suites, both against an exported web build served under /FinFeast/ exactly as GitHub Pages serves it:
 *
 * - `smoke` (tests/*.spec.ts): the deployable build in dist/. Export it first with `npm run export:web`.
 *   These tests stay on the signed-out screens, so they never call the backend.
 * - `food` (tests/e2e/*.spec.ts): a separate export in dist-e2e/, built here with a mock Supabase URL that the
 *   tests answer (tests/e2e/mockSupabase.ts), so no live backend, account or photo API is needed.
 *   It never touches dist/, so the build CI deploys is never replaced by the mock build.
 *
 * Unit tests (`*.test.mjs`) run under `node --test` via `npm run test:unit`.
 * See https://playwright.dev/docs/test-configuration.
 */
const SMOKE_PORT = 3000;
const FOOD_PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'smoke',
      testMatch: '*.spec.ts',
      testIgnore: 'e2e/**',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${SMOKE_PORT}/FinFeast/` },
    },
    {
      name: 'food',
      testMatch: 'e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${FOOD_PORT}/FinFeast/` },
    },
  ],
  webServer: [
    {
      command: 'npm run serve:web',
      url: `http://localhost:${SMOKE_PORT}/FinFeast/`,
      env: { PORT: String(SMOKE_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx expo export -p web --output-dir dist-e2e && node scripts/postexport-web.mjs dist-e2e && node scripts/serve-web.mjs dist-e2e',
      url: `http://localhost:${FOOD_PORT}/FinFeast/`,
      // Process env wins over .env, so this export always targets the mock backend.
      env: { PORT: String(FOOD_PORT), EXPO_PUBLIC_SUPABASE_URL: E2E_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: E2E_ANON_KEY },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
