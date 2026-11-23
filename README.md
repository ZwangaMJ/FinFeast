# FinFeast

Personal financial wellness & meal planning — built from `FinFeast_PRD_and_Design_Spec.md` v1.0.
Expo (SDK 58) + Expo Router + TypeScript, runs on iOS, Android and web.

## Run it

```bash
npm install
npx expo start          # press i / a for simulators, or scan with Expo Go
npx expo start --web    # browser
```

Checks: `npm run lint`, `npm run typecheck`, `npm run test:unit` and `npm run test:e2e` (Node.js 22+).

`test:e2e` builds the web export against a mock Supabase URL and answers every backend and photo request in the test (`tests/e2e/mockSupabase.ts`), so it needs no account, project or API key. It exports to `dist-e2e/`, so the deployable `dist/` is never replaced by the mock build.

## Accounts and data

Email/password sign-in and account creation use Supabase Auth. Auth tokens are stored in the iOS Keychain or Android Keystore; web sessions use browser local storage. App data syncs to Supabase under the signed-in user and is protected by row-level security. Native app data is also cached with AsyncStorage while signed in and removed when you sign out; that local data cache is not separately encrypted.

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`, apply all SQL migrations in `supabase/migrations` in filename order to your Supabase project, and enable email/password auth. Email confirmation behavior follows the Supabase project's Auth settings. A device's existing local data is imported into the first signed-in account only if that account has no saved cloud profile.

## What's in the prototype

| Spec area | Where |
|---|---|
| Onboarding (5 steps, manual-mode fallback, notifications asked last) | `src/app/onboarding.tsx` |
| Document flow U2–U6: upload sheet, type confirm, processing, review with confidence tints, conflicts, duplicates, illegible scans | `src/components/DocumentFlow.tsx` |
| Home: safety-net strip, hero flexible number, food ring, today's meals, insight of the day, quick actions | `src/app/(tabs)/index.tsx` |
| Money: cashflow forecast with confidence band, actual-vs-plan bars, risky-day heat strip, category envelopes, subscriptions manager, transactions (re-categorise, question chips), documents | `src/app/(tabs)/money.tsx` |
| Meals: 7-day plan, swap meal / regenerate day / week, batch-cook leftovers, cheaper swaps, budget-light proposals, nutrition-floor conflict, grocery list, pantry | `src/app/(tabs)/meals.tsx`, `src/app/meal/[id].tsx`, `src/app/grocery.tsx`, `src/app/pantry.tsx` |
| My meals and groceries: create, edit and delete meals (starter meals can be edited or removed per user), add / edit / check off / delete grocery items, food photos with emoji fallback | `src/app/recipes.tsx`, `src/app/recipe/[id].tsx`, `src/app/grocery.tsx`, `src/components/FoodImage.tsx`, `src/hooks/useFood.ts` |
| Goals: Security Meter, Found Money inbox (send / split / keep), goal detail with rule builder (meal surplus, payday sweep, % split, round-ups, month-end check) | `src/app/(tabs)/goals.tsx`, `src/app/goal/` |
| Profile: household & diet, money basics, theme (system/light/dark), notifications, export JSON, delete all data | `src/app/(tabs)/profile.tsx` |

Engines (pure TypeScript, no UI):

- `src/lib/catalog.ts` — the meal catalogue: starter recipes (`src/data/recipes.ts`) merged with the user's meals. New meals and meals with your own cost are priced per serving through one virtual ingredient, so costs, the budget solver and the grocery list work unchanged.
- `src/store/food.ts` — pure create / update / delete transitions and validation for meals and grocery items.
- `src/lib/mealPlanner.ts` — constraint solver: hard filters → budget ceiling → calories ±10% & protein floor → variety → batch cooking; pack-rounded, consolidated grocery list with pantry credits; honest `budget_floor_conflict`.
- `src/lib/budget.ts` — income − bills − committed goals = flexible money; month forecast; risky days; Security Meter.
- `src/lib/payslip.ts` — South African payslip DTO extraction, currency normalization, validation warnings, and disposable-income analysis.
- `src/lib/bankStatement.ts` — local, multi-page South African bank statement parsing, transaction categorization, balance reconciliation, recurring-payment analysis, and cash-flow insights.
- `src/lib/insights.ts` — ranked, data-anchored insights ((money × actionability) ÷ effort), never shaming.
- `src/store/useStore.ts` — app state, synced to the signed-in Supabase account and cached per account on the device, Found Money routing rules, weekly rollover (underspend → Found Money, overspend → budget-light week), payday and month-end rules.

## Not real yet

- **Payslip and bank statement PDFs are parsed locally** with PDF.js on web and native PDFKit/PDFBox extraction on iOS/Android. Parsing does not upload the PDF or full account number; normalized transactions follow the app's data persistence settings. Bank statement results include typed transactions, account/period metadata, Dr/Cr balances, debit-order and fee categorization, reconciliation checks, and budget analysis. Unposted debit-order attempts remain visible as anomalies but are excluded from cash-flow totals. Web loads the matching PDF.js worker from cdnjs, so web extraction needs an internet connection. Mobile PDF extraction requires an app development build and is unavailable in Expo Go. Scanned documents, receipts, and tax forms are not currently extracted. The app does not load sample financial records; financial summaries use uploaded documents or values the user enters.
- **Notifications** are stored as preferences; no push service is wired up.
- **Your meals and groceries** are stored in the `meals` and `groceries` tables. Row-level security means each user can only read and change their own rows. The starter meals live in the app, not the database, so new and existing users get them without any seeding. `meals` only holds what you change:
  - meals you create;
  - your edited copy of a starter (`base_recipe_id`);
  - starters you removed (`hidden`), which you can restore from My meals.

  Changes show immediately and are cached on the device. They save in the background through `replace_user_food`, which retries when you're back online. Deleting a planned meal gives that slot a new meal.
- **Food photos** come from the [Pixabay API](https://pixabay.com/api/docs/) through the `fetch-food-image` Supabase Edge Function. The function checks the public-read `food_image_cache` table first, keyed by name, meal or grocery, and provider. Only on a miss does it search Pixabay, so a name costs one API call per cache period across all users, well under Pixabay's limit of 100 requests per 60 seconds. "No match" answers are cached for 24 hours, as Pixabay requires. A rate-limited (`429`) or failed search caches nothing and is retried later.
  - Pixabay doesn't allow permanent hotlinking, so the function copies the chosen photo (1280 px, plus a 640 px thumbnail) into the public `meal-images` Storage bucket. The cache stores only URLs of those copies, keeps them for a year, and deletes copies a refreshed photo replaces.
  - Results are ranked by how well their tags match the name. Local spellings like "bolognaise" are normalised first, and the dish word counts double. A photo has to match more than half of the name, so an unrelated photo never stands in.
  - A meal's photo is stored on its row when you create or rename it.
  - Meal Detail credits the photographer ("Photo: _name_ on Pixabay") with a link to the photo's Pixabay page, plus an "Images from Pixabay" link.
  - `PIXABAY_API_KEY` is a Supabase function secret, never `EXPO_PUBLIC_*`.
  - Without the key, offline, with no match, or when a photo fails to load, the app shows the emoji tile.

  Setup:
  ```bash
  npx supabase db push --remote                           # meals, groceries, food_image_cache, meal-images bucket
  npx supabase secrets set PIXABAY_API_KEY=...
  npx supabase functions deploy fetch-food-image --use-api
  ```
- Meal-planning costs use a fixed South African reference price list scaled for other currencies, plus your own per-serving estimates for meals you price yourself. These are estimates, not the user's transaction data.
- P2 items (bank feeds, household sharing, investment partners) are shown as "coming soon".
