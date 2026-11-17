import { expect, test } from '@playwright/test';

// A fresh browser has no saved data, so the app should land on onboarding.

test('app loads to onboarding without errors', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  await page.goto('./');

  await expect(page).toHaveURL(/\/FinFeast\/onboarding/);
  await expect(page.getByText('FinFeast', { exact: true })).toBeVisible();
  await expect(page.getByText('Eat well. Spend less. Grow the difference.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('deep link loads the app (404.html fallback)', async ({ page }) => {
  await page.goto('onboarding');

  await expect(page).toHaveURL(/\/FinFeast\/onboarding/);
  await expect(page.getByText('FinFeast', { exact: true })).toBeVisible();
});
