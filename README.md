# FinFeast

Personal financial wellness & meal planning — built from `FinFeast_PRD_and_Design_Spec.md` v1.0.
Expo (SDK 58) + Expo Router + TypeScript, runs on iOS, Android and web.

## Run it

```bash
npm install
npx expo start          # press i / a for simulators, or scan with Expo Go
npx expo start --web    # browser
```

Checks (Node.js 22+): `npm run lint`, `npm run typecheck`, `npm run test:unit` (parser, auth, recurring-expense, engine and food tests).

Web E2E tests (Playwright, against exported builds served under `/FinFeast/`):

```bash
npm run export:web      # expo export -p web → dist/, plus 404.html and .nojekyll for GitHub Pages
npx playwright install chromium
npm run test:e2e        # smoke: serves dist/ on :3000 and runs tests/*.spec.ts
                        # food: exports dist-e2e/ against a mock Supabase and runs tests/e2e/*.spec.ts
```

The `food` suite answers every backend and photo request in the test (`tests/e2e/mockSupabase.ts`), so it needs no account, project or API key. It exports to `dist-e2e/`, so the deployable `dist/` is never replaced by the mock build.

## Deployment

The web build is published to GitHub Pages at **https://zwangamj.github.io/FinFeast/**. `experiments.baseUrl` in `app.json` is `/FinFeast` so assets resolve under that path.

| Workflow | Runs on | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Pull requests to `main` (and when called by deploy) | `checks`: lint, typecheck, parser tests. `e2e`: export the web build, run Playwright smoke tests, upload the report and the tested `dist/` as `web-dist`. |
| `.github/workflows/deploy-web.yml` | Push to `main`, or the Run workflow button | Runs `ci.yml`, then deploys the `web-dist` artifact (exactly what was tested) to GitHub Pages. |
| `.github/workflows/android-release.yml` | A version tag like `v1.2.3`, or the Run workflow button | Runs `ci.yml`, builds a signed release APK on the runner, and publishes it as a GitHub Release (tags) or a workflow artifact (manual runs). |

No secrets are needed: Pages deploys with the workflow's built-in token. The web build does need two **repository variables**, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the publishable key). Both are public by design, since they ship in the app. CI fails early with a clear message if either is missing.

One-time GitHub setup:

1. **Settings → General → Danger Zone → Change visibility → Public** (free GitHub Pages needs a public repo).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Do this before the first merge, or the deploy job fails.
3. After `ci.yml` has run once on a PR: **Settings → Rules → Rulesets → New branch ruleset** targeting `main`, enable **Require status checks to pass**, and add `checks` and `e2e`.

### Android APK

Android builds are made on the GitHub runner, not EAS: `expo prebuild` generates `android/`, then Gradle builds `assembleRelease` for arm64-v8a and armeabi-v7a. The APK uses the same Supabase project as the web build.

To release, push a tag. The tag sets the version name, and the version code is `MAJOR*10000 + MINOR*100 + PATCH` (`scripts/set-android-version.mjs`), so every release installs as an update over the last:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The release page has `FinFeast-v1.0.0.apk` and its SHA-256. To install it, open the APK on the phone and allow installing unknown apps when Android asks.

One-time signing setup. Run these in your own terminal and keep the passwords out of chat and git:

1. Create the release keystore (`*.jks` is gitignored):
   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore finfeast-release.jks -alias finfeast -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Add four repository secrets:
   ```bash
   base64 -w0 finfeast-release.jks | gh secret set ANDROID_KEYSTORE_BASE64
   gh secret set ANDROID_KEYSTORE_PASSWORD
   gh secret set ANDROID_KEY_ALIAS --body finfeast
   gh secret set ANDROID_KEY_PASSWORD
   ```
3. **Back up `finfeast-release.jks` and its passwords** in a password manager. Android only installs updates signed with the same key. If the key is lost, people have to uninstall FinFeast and lose its local data before they can install a new version.

## Accounts and data

FinFeast requires an account. People sign in with email and password; confirming an email and resetting a password both use a 6-digit code emailed through Supabase (custom SMTP via Brevo). Each account's data is stored in Supabase behind row-level security and syncs automatically. Profile has change password, sign out and delete account.

- Setup steps (migrations, email templates, build variables): [docs/supabase-auth-setup.md](docs/supabase-auth-setup.md)
- Auth flow: `src/lib/auth/authController.ts` (tested in `tests/authController.test.mjs`); wired up in `src/store/useAuthStore.ts`
- Screens: `src/app/sign-in.tsx`, `src/components/AccountSettings.tsx`
- Local development needs `.env` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). iOS/Android need a development build (session storage uses `expo-secure-store`).

## What's in the prototype

| Spec area | Where |
|---|---|
| Onboarding (5 steps, manual-mode fallback, notifications asked last) | `src/app/onboarding.tsx` |
| Document flow U2–U6: upload sheet, type confirm, processing, review with confidence tints, conflicts, duplicates, illegible scans | `src/components/DocumentFlow.tsx` |
| Home: safety-net strip, hero flexible number, food ring, today's meals, insight of the day, quick actions | `src/app/(tabs)/index.tsx` |
| Money: cashflow forecast with confidence band, actual-vs-plan bars, risky-day heat strip, category envelopes, Recurring Expenses & Bills (fixed essentials vs subscriptions), transactions (re-categorise, question chips), documents | `src/app/(tabs)/money.tsx` |
| Meals: 7-day plan, swap meal / regenerate day / week, batch-cook leftovers, cheaper swaps, budget-light proposals, nutrition-floor conflict, grocery list, pantry | `src/app/(tabs)/meals.tsx`, `src/app/meal/[id].tsx`, `src/app/grocery.tsx`, `src/app/pantry.tsx` |
| My meals and groceries: create, edit and delete meals (starter meals can be edited or removed per user), add / edit / check off / delete grocery items, food photos with emoji fallback | `src/app/recipes.tsx`, `src/app/recipe/[id].tsx`, `src/app/grocery.tsx`, `src/components/FoodImage.tsx`, `src/hooks/useFood.ts` |
| Goals: Security Meter, Found Money inbox (send / split / keep), goal detail with rule builder (meal surplus, payday sweep, % split, round-ups, month-end check) | `src/app/(tabs)/goals.tsx`, `src/app/goal/` |
| Profile: household & diet, money basics, theme (system/light/dark), notifications, export JSON, delete all data | `src/app/(tabs)/profile.tsx` |

Engines (pure TypeScript, no UI):

- `src/lib/catalog.ts` — the meal catalogue: starter recipes (`src/data/recipes.ts`) merged with the user's meals. New meals and meals with your own cost are priced per serving through one virtual ingredient, so costs, the budget solver and the grocery list work unchanged.
- `src/store/food.ts` — pure create / update / delete transitions and validation for meals and grocery items.
- `src/lib/mealPlanner.ts` — constraint solver: hard filters → budget ceiling → calories ±10% & protein floor → variety → batch cooking; pack-rounded, consolidated grocery list with pantry credits; honest `budget_floor_conflict`.
- `src/lib/recurring.ts` — recurring expenses (rent, transport, utilities, insurance, subscriptions, debt): monthly equivalents, debits placed on billing days, low-balance days, bill creep, fixed-cost ratio.
- `src/lib/budget.ts` — income − recurring expenses − committed goals = flexible money; month forecast; risky days; Security Meter.
- `src/lib/payslip.ts` — South African payslip DTO extraction, currency normalization, validation warnings, and disposable-income analysis.
- `src/lib/bankStatement.ts` — local, multi-page South African bank statement parsing, transaction categorization, balance reconciliation, recurring-payment detection (debit orders, EFTs, repeat card charges) with de-duplication against saved expenses, and cash-flow insights.
- `src/lib/insights.ts` — ranked, data-anchored insights ((money × actionability) ÷ effort), fixed obligations kept apart from everyday habits, never shaming.
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
