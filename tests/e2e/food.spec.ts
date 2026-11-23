import { expect, test, type Page } from '@playwright/test';

import { mockSupabase } from './mockSupabase';

/**
 * Meals, groceries and food photos against the static web export and a mocked Supabase
 * (tests/e2e/mockSupabase.ts). No live backend, account or photo API is used.
 */
const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });
const byLabel = (page: Page, label: string) => page.getByLabel(label, { exact: true }).filter({ visible: true }).first();
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();

/** Sheets slide out and swallow input until unmounted; wait for the modal to be gone. */
const sheetClosed = (page: Page) => expect(page.locator('[aria-modal="true"]')).toHaveCount(0);

async function openMeals(page: Page) {
  await page.goto('/meals');
  const build = button(page, 'Build my week');
  if (await build.isVisible({ timeout: 15_000 }).catch(() => false)) await build.click();
  await expect(visible(page, 'food-image').first()).toBeVisible({ timeout: 30_000 });
}

test('signed out: the web export boots to sign-in without calling a photo API', async ({ page }) => {
  const errors: string[] = [];
  const photoCalls: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route(/pixabay\.com|\/functions\/v1\/fetch-food-image/, (route) => {
    photoCalls.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await expect(page.getByPlaceholder('you@example.com').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  expect(photoCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('meal tiles fall back to emoji when no photo is available', async ({ page }) => {
  await mockSupabase(page);
  await openMeals(page);
  await expect(visible(page, 'food-image-fallback').first()).toBeVisible();
  await expect(page.getByTestId('food-image-photo')).toHaveCount(0);
});

test('meal CRUD: create, edit and delete a custom meal', async ({ page }) => {
  const saved = await mockSupabase(page);
  await page.goto('/recipes');
  await button(page, 'New meal').click();

  await byLabel(page, 'Name').fill('E2E lentil curry');
  await byLabel(page, 'Estimated cost per serving').fill('32');
  await byLabel(page, 'Calories').fill('610');
  await button(page, 'Add meal').click();

  await expect(page.getByText('E2E lentil curry').filter({ visible: true }).first()).toBeVisible();
  await expect.poll(() => saved.meals.map((m) => (m as { name: string }).name), { timeout: 10_000 }).toEqual(['E2E lentil curry']);
  const created = saved.meals[0] as { kcal: number; costPerServing: number; baseRecipeId: null };
  expect(created).toMatchObject({ kcal: 610, costPerServing: 32, baseRecipeId: null });

  await page.getByText('E2E lentil curry').filter({ visible: true }).first().click();
  await byLabel(page, 'Name').fill('E2E dal');
  await button(page, 'Save changes').click();
  await expect(page.getByText('E2E dal').filter({ visible: true }).first()).toBeVisible();
  await expect.poll(() => saved.meals.map((m) => (m as { name: string }).name), { timeout: 10_000 }).toEqual(['E2E dal']);

  await page.getByText('E2E dal').filter({ visible: true }).first().click();
  await button(page, 'Delete meal').click();
  await button(page, 'Delete').click();
  await expect(page.getByText('E2E dal').filter({ visible: true })).toHaveCount(0);
  await expect.poll(() => saved.meals.length, { timeout: 10_000 }).toBe(0);
});

test('editing a starter meal saves a personal copy; removing hides it', async ({ page }) => {
  const saved = await mockSupabase(page);
  await page.goto('/recipes');
  await page.getByText('Banana peanut-butter oats').filter({ visible: true }).first().click();
  await byLabel(page, 'Name').fill('My banana oats');
  await button(page, 'Save changes').click();
  await expect(page.getByText('My banana oats').filter({ visible: true }).first()).toBeVisible();
  await expect.poll(() => saved.meals.map((m) => (m as { baseRecipeId: string; name: string })), { timeout: 10_000 }).toEqual([expect.objectContaining({ baseRecipeId: 'b_oats', name: 'My banana oats', hidden: false })]);

  await page.getByText('My banana oats').filter({ visible: true }).first().click();
  await button(page, 'Remove from my meals').click();
  await button(page, 'Remove').click();
  await expect(page.getByText('Removed starter meals').filter({ visible: true })).toBeVisible();
  await expect.poll(() => saved.meals.map((m) => (m as { hidden: boolean }).hidden), { timeout: 10_000 }).toEqual([true]);

  await button(page, 'Restore My banana oats').click();
  await expect(page.getByText('Removed starter meals').filter({ visible: true })).toHaveCount(0);
});

test('grocery CRUD: add, check off, edit and delete an item', async ({ page }) => {
  const saved = await mockSupabase(page);
  await openMeals(page);
  // Navigate in-app: a reload would reload state from the mock, which doesn't store the plan.
  await page.getByRole('button', { name: /^Grocery list,/ }).filter({ visible: true }).first().click();

  await button(page, 'Add grocery item').click();
  await byLabel(page, 'Item').fill('E2E chutney');
  await byLabel(page, 'Quantity').fill('2');
  await byLabel(page, 'Unit').fill('bunch');
  await button(page, 'Add item').click();
  await sheetClosed(page);

  const row = page.getByRole('checkbox', { name: /^E2E chutney,/ }).filter({ visible: true }).first();
  await expect(row).toBeVisible();
  await expect.poll(() => saved.groceries.map((g) => (g as { name: string }).name), { timeout: 10_000 }).toEqual(['E2E chutney']);

  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => (saved.groceries[0] as { checked: boolean } | undefined)?.checked, { timeout: 10_000 }).toBe(true);

  await button(page, 'Edit E2E chutney').click();
  await byLabel(page, 'Item').fill('E2E mango chutney');
  await button(page, 'Save item').click();
  await sheetClosed(page);
  await expect(page.getByRole('checkbox', { name: /^E2E mango chutney,/ }).filter({ visible: true }).first()).toBeVisible();

  await expect.poll(() => saved.groceries.map((g) => (g as { name: string }).name), { timeout: 10_000 }).toEqual(['E2E mango chutney']);
  await button(page, 'Delete E2E mango chutney').click();
  await expect(page.getByRole('checkbox', { name: /^E2E mango chutney,/ }).filter({ visible: true })).toHaveCount(0);
  await expect.poll(() => saved.groceries.length, { timeout: 10_000 }).toBe(0);
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#c96"/></svg>';

/** Answers `fetch-food-image` with a photo at `file` (served as a small SVG when it's ok.svg, 404 otherwise). */
async function mockPhotos(page: Page, file: 'ok.svg' | 'missing.svg') {
  await page.route('https://photos.e2e.test/**', (route) =>
    route.request().url().endsWith('/ok.svg') ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }) : route.fulfill({ status: 404, body: '' }),
  );
  return mockSupabase(page, {
    foodImage: () => ({
      status: 'ok',
      provider: 'pixabay',
      image_url: `https://photos.e2e.test/${file}`,
      thumb_url: `https://photos.e2e.test/${file}`,
      photographer_name: 'Ella Olsson',
      photographer_url: 'https://pixabay.com/users/ella-1/',
      source_url: 'https://pixabay.com/photos/1/',
      fetched_at: new Date().toISOString(),
    }),
  });
}

test('photos show on meal tiles, with photographer and Pixabay attribution on the meal', async ({ page }) => {
  await mockPhotos(page, 'ok.svg');
  await openMeals(page);
  await expect(visible(page, 'food-image-photo').first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: /^Breakfast: / }).filter({ visible: true }).first().click();
  await expect(page.getByText('Photo: Ella Olsson on Pixabay').filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Images from Pixabay').filter({ visible: true }).first()).toBeVisible();
});

test('a photo that fails to load falls back to the emoji tile', async ({ page }) => {
  await mockPhotos(page, 'missing.svg');
  await openMeals(page);
  await expect(visible(page, 'food-image-fallback').first()).toBeVisible();
  // expo-image reports the 404 and the photo layer is removed.
  await expect(visible(page, 'food-image-photo')).toHaveCount(0, { timeout: 15_000 });
});
