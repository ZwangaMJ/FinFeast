# FinFeast

Personal financial wellness & meal planning — built from `FinFeast_PRD_and_Design_Spec.md` v1.0.
Expo (SDK 58) + Expo Router + TypeScript, runs on iOS, Android and web.

## Run it

```bash
npm install
npx expo start          # press i / a for simulators, or scan with Expo Go
npx expo start --web    # browser
```

Checks: `npx tsc --noEmit` and `npx eslint src`.

## What's in the prototype

| Spec area | Where |
|---|---|
| Onboarding (5 steps, manual-mode fallback, notifications asked last) | `src/app/onboarding.tsx` |
| Document flow U2–U6: upload sheet, type confirm, processing, review with confidence tints, conflicts, duplicates, illegible scans | `src/components/DocumentFlow.tsx` |
| Home: safety-net strip, hero flexible number, food ring, today's meals, insight of the day, quick actions | `src/app/(tabs)/index.tsx` |
| Money: cashflow forecast with confidence band, what-if simulator, actual-vs-plan bars, risky-day heat strip, category envelopes, subscriptions manager, transactions (re-categorise, question chips), documents | `src/app/(tabs)/money.tsx` |
| Meals: 7-day plan, swap meal / regenerate day / week, batch-cook leftovers, cheaper swaps, budget-light proposals, nutrition-floor conflict, grocery list, pantry | `src/app/(tabs)/meals.tsx`, `src/app/meal/[id].tsx`, `src/app/grocery.tsx`, `src/app/pantry.tsx` |
| Goals: Security Meter, Found Money inbox (send / split / keep), goal detail with rule builder (meal surplus, payday sweep, % split, round-ups, month-end check) | `src/app/(tabs)/goals.tsx`, `src/app/goal/` |
| Profile: household & diet, money basics, theme (system/light/dark), notifications, export JSON, delete all data | `src/app/(tabs)/profile.tsx` |

Engines (pure TypeScript, no UI):

- `src/lib/mealPlanner.ts` — constraint solver: hard filters → budget ceiling → calories ±10% & protein floor → variety → batch cooking; pack-rounded, consolidated grocery list with pantry credits; honest `budget_floor_conflict`.
- `src/lib/budget.ts` — income − bills − committed goals = flexible money; month forecast; risky days; Security Meter.
- `src/lib/insights.ts` — ranked, data-anchored insights ((money × actionability) ÷ effort), never shaming.
- `src/store/useStore.ts` — persisted state (AsyncStorage), Found Money routing rules, weekly rollover (underspend → Found Money, overspend → budget-light week), payday and month-end rules.

## Not real yet

- **Document AI is simulated on-device** (`src/lib/parser.ts`) so every state can be exercised. Production should send files to a backend that masks PII and runs the prompts in `src/lib/prompts.ts`; never ship a model API key in the app.
- **Sign-in is simulated** (any 6-digit code; Google/Apple buttons just continue). Data lives on the device only.
- **Notifications** are stored as preferences; no push service is wired up.
- Meal "photos" are emoji tiles; recipe prices are a fixed South African price list scaled for other currencies.
- P2 items (bank feeds, household sharing, investment partners) are shown as "coming soon".
