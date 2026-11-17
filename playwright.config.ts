import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against the exported web build (`npm run export:web`),
 * served under /FinFeast/ exactly as GitHub Pages serves it.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Only Playwright specs; tests/*.test.mjs are node:test parser tests. */
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: 'http://localhost:3000/FinFeast/',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  /* Serve dist/ — export it first with `npm run export:web`. */
  webServer: {
    command: 'npm run serve:web',
    url: 'http://localhost:3000/FinFeast/',
    reuseExistingServer: !process.env.CI,
  },
});
