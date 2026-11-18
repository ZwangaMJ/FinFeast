import { expect, test } from '@playwright/test';

// A fresh browser has no session, so every route should land on sign-in.

test('app loads to the sign-in screen without errors', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));

  await page.goto('./');

  await expect(page).toHaveURL(/\/FinFeast\/sign-in/);
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a signed-out deep link is sent to sign-in (404.html fallback)', async ({ page }) => {
  await page.goto('goals');

  await expect(page).toHaveURL(/\/FinFeast\/sign-in/);
  await expect(page.getByText('Welcome back')).toBeVisible();
});

test('the sign-in screen checks input before calling the server', async ({ page }) => {
  await page.goto('./');

  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByText('Sign in', { exact: true }).click();

  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
});

test('you can switch to creating an account and to resetting a password', async ({ page }) => {
  await page.goto('./');

  await page.getByText('New to FinFeast? Create an account').click();
  await expect(page.getByText('Create your account')).toBeVisible();

  await page.getByText('Back to sign in').click();
  await page.getByText('Forgot your password?').click();
  await expect(page.getByText('Reset your password')).toBeVisible();
});
