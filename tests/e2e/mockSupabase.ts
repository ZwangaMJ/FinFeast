import type { Page, Route } from '@playwright/test';

/**
 * A tiny in-memory Supabase for E2E tests. The web export is built against
 * `E2E_SUPABASE_URL` (see playwright.config.ts), and every request to it is answered here:
 * no real Supabase project, photo API or account is needed, so CI runs the full signed-in
 * app deterministically.
 */
export const E2E_SUPABASE_URL = 'https://e2e-mock.supabase.co';
export const E2E_ANON_KEY = 'e2e-anon-key';
const STORAGE_KEY = 'sb-e2e-mock-auth-token';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'e2e@example.com';

type Saved = { meals: unknown[]; groceries: unknown[]; data: Record<string, unknown> | null };

export type MockOptions = {
  /** What `fetch-food-image` answers. Default: unavailable (unconfigured) → emoji fallback. */
  foodImage?: (body: { query: string; kind: string }) => Record<string, unknown>;
};

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fakeJwt = (exp: number) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp })}.signature`;

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' };
  return { access_token: fakeJwt(expiresAt), refresh_token: 'e2e-refresh', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, user };
}

const profileRow = {
  user_id: USER_ID,
  name: 'E2E',
  household_size: 2,
  currency: 'ZAR',
  diet: 'omnivore',
  allergies: [],
  calorie_target: 2000,
  max_cook_minutes: 45,
  goal_priority: 'safety',
  theme_mode: 'light',
  notifications: false,
  risk_alerts: true,
  weekly_digest: true,
  onboarded: true,
  manual_mode: true,
};
const financeRow = { user_id: USER_ID, weekly_food_budget: 1500, tax_info: null, last_month_processed: null, last_payday_processed: null };

const json = (route: Route, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers }, body: JSON.stringify(body) });

/** Signs the page in as a fake onboarded user and answers all Supabase traffic. Returns what the app saved. */
export async function mockSupabase(page: Page, opts: MockOptions = {}): Promise<Saved> {
  const saved: Saved = { meals: [], groceries: [], data: null };
  const s = session();
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [STORAGE_KEY, JSON.stringify(s)] as const);

  await page.route(`${E2E_SUPABASE_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

    if (path.startsWith('/auth/v1/')) {
      if (path.endsWith('/user')) return json(route, s.user);
      if (path.endsWith('/token')) return json(route, s);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    if (path === '/rest/v1/rpc/replace_user_data') {
      saved.data = req.postDataJSON()?.p_data ?? null;
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (path === '/rest/v1/rpc/replace_user_food') {
      const body = req.postDataJSON() ?? {};
      saved.meals = body.p_meals ?? [];
      saved.groceries = body.p_groceries ?? [];
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      const rows = table === 'user_profiles' ? [profileRow] : table === 'user_finances' ? [financeRow] : [];
      return json(route, rows, { 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' });
    }

    if (path === '/functions/v1/fetch-food-image') {
      const body = req.postDataJSON() ?? {};
      return json(route, opts.foodImage ? opts.foodImage(body) : { status: 'unavailable', reason: 'not_configured' });
    }

    return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
  });

  return saved;
}
