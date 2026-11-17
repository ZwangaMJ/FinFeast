# FinFeast

Personal financial wellness & meal planning — built from `FinFeast_PRD_and_Design_Spec.md` v1.0.
Expo (SDK 58) + Expo Router + TypeScript, runs on iOS, Android and web.

## Run it

```bash
npm install
npx expo start          # press i / a for simulators, or scan with Expo Go
npx expo start --web    # browser
```

Checks (Node.js 22+): `npm run lint`, `npm run typecheck`, `npm run test:unit` (payslip and bank-statement parser tests).

Web smoke tests (Playwright, against the exported build):

```bash
npm run export:web      # expo export -p web → dist/, plus 404.html and .nojekyll for GitHub Pages
npx playwright install chromium
npm run test:e2e        # serves dist/ at http://localhost:3000/FinFeast/ and runs tests/*.spec.ts
```

## Deployment

The web build is published to GitHub Pages at **https://zwangamj.github.io/FinFeast/**. `experiments.baseUrl` in `app.json` is `/FinFeast` so assets resolve under that path.

| Workflow | Runs on | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | Pull requests to `main` (and when called by deploy) | `checks`: lint, typecheck, parser tests. `e2e`: export the web build, run Playwright smoke tests, upload the report and the tested `dist/` as `web-dist`. |
| `.github/workflows/deploy-web.yml` | Push to `main`, or the Run workflow button | Runs `ci.yml`, then deploys the `web-dist` artifact (exactly what was tested) to GitHub Pages. |

No secrets are needed: Pages deploys with the workflow's built-in token, and no Supabase variables are baked into the web build while cloud sync is disabled.

One-time GitHub setup:

1. **Settings → General → Danger Zone → Change visibility → Public** (free GitHub Pages needs a public repo).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** Do this before the first merge, or the deploy job fails.
3. After `ci.yml` has run once on a PR: **Settings → Rules → Rulesets → New branch ruleset** targeting `main`, enable **Require status checks to pass**, and add `checks` and `e2e`.

## Accounts and data

Email sign-in and Supabase cloud sync are temporarily disabled while account setup is being completed. No account is needed to use the app; app data is saved locally on the device.

## What's in the prototype

| Spec area | Where |
|---|---|
| Onboarding (5 steps, manual-mode fallback, notifications asked last) | `src/app/onboarding.tsx` |
| Document flow U2–U6: upload sheet, type confirm, processing, review with confidence tints, conflicts, duplicates, illegible scans | `src/components/DocumentFlow.tsx` |
| Home: safety-net strip, hero flexible number, food ring, today's meals, insight of the day, quick actions | `src/app/(tabs)/index.tsx` |
| Money: cashflow forecast with confidence band, actual-vs-plan bars, risky-day heat strip, category envelopes, subscriptions manager, transactions (re-categorise, question chips), documents | `src/app/(tabs)/money.tsx` |
| Meals: 7-day plan, swap meal / regenerate day / week, batch-cook leftovers, cheaper swaps, budget-light proposals, nutrition-floor conflict, grocery list, pantry | `src/app/(tabs)/meals.tsx`, `src/app/meal/[id].tsx`, `src/app/grocery.tsx`, `src/app/pantry.tsx` |
| Goals: Security Meter, Found Money inbox (send / split / keep), goal detail with rule builder (meal surplus, payday sweep, % split, round-ups, month-end check) | `src/app/(tabs)/goals.tsx`, `src/app/goal/` |
| Profile: household & diet, money basics, theme (system/light/dark), notifications, export JSON, delete all data | `src/app/(tabs)/profile.tsx` |

Engines (pure TypeScript, no UI):

- `src/lib/mealPlanner.ts` — constraint solver: hard filters → budget ceiling → calories ±10% & protein floor → variety → batch cooking; pack-rounded, consolidated grocery list with pantry credits; honest `budget_floor_conflict`.
- `src/lib/budget.ts` — income − bills − committed goals = flexible money; month forecast; risky days; Security Meter.
- `src/lib/payslip.ts` — South African payslip DTO extraction, currency normalization, validation warnings, and disposable-income analysis.
- `src/lib/bankStatement.ts` — local, multi-page South African bank statement parsing, transaction categorization, balance reconciliation, recurring-payment analysis, and cash-flow insights.
- `src/lib/insights.ts` — ranked, data-anchored insights ((money × actionability) ÷ effort), never shaming.
- `src/store/useStore.ts` — app state, locally persisted on the device, Found Money routing rules, weekly rollover (underspend → Found Money, overspend → budget-light week), payday and month-end rules.

## Not real yet

- **Payslip and bank statement PDFs are parsed locally** with PDF.js on web and native PDFKit/PDFBox extraction on iOS/Android. Parsing does not upload the PDF or full account number; normalized transactions follow the app's data persistence settings. Bank statement results include typed transactions, account/period metadata, Dr/Cr balances, debit-order and fee categorization, reconciliation checks, and budget analysis. Unposted debit-order attempts remain visible as anomalies but are excluded from cash-flow totals. Web loads the matching PDF.js worker from cdnjs, so web extraction needs an internet connection. Mobile PDF extraction requires an app development build and is unavailable in Expo Go. Scanned documents, receipts, and tax forms are not currently extracted. The app does not load sample financial records; financial summaries use uploaded documents or values the user enters.
- **Notifications** are stored as preferences; no push service is wired up.
- Meal "photos" are emoji tiles. Meal-planning costs use a fixed South African reference price list scaled for other currencies; these are estimates, not the user's transaction data.
- P2 items (bank feeds, household sharing, investment partners) are shown as "coming soon".
