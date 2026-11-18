# Supabase setup for FinFeast accounts

FinFeast signs users in with **email + password**. Confirming an email and resetting a password both use a **6-digit code sent by email** (no links), so the same flow works on web, iOS and Android without deep-link setup. Email is sent through your custom SMTP provider (Brevo).

Do these once, in the Supabase dashboard for the FinFeast project.

## 1. Apply the database migrations

Run each file from `supabase/migrations/` in the **SQL Editor**, in filename order. Skip any that are already applied.

| File | What it does | Already applied if… |
|---|---|---|
| `20261105000000_finfeast_data.sql` | Creates the 15 per-user tables, row-level security and `replace_user_data` | **Table Editor** shows `user_profiles` |
| `20261110000000_fix_empty_meal_plan_save.sql` | Fixes `replace_user_data` failing for users without a meal plan, which is every new account | Safe to run again (`create or replace`) |
| `20261117000000_delete_my_account.sql` | Adds `delete_my_account()`, used by **Profile → Delete my account** | Safe to run again (`create or replace`) |

## 2. Email sign-in settings

**Authentication → Sign In / Providers → Email**:

- **Email** provider: enabled.
- **Confirm email**: on. New accounts must enter the emailed code before they can sign in.
- **Minimum password length**: 8. The app checks this too.
- **Email OTP length**: 6. The app accepts 6–10 digits.
- **Email OTP expiration**: the default is fine. A code older than this is rejected, and the user can request a new one.

## 3. Put the code in the emails

**Authentication → Emails → Templates**. The default templates send a link. Change two of them so the email shows the code instead, using `{{ .Token }}`.

**Confirm signup**:

```html
<h2>Confirm your FinFeast account</h2>
<p>Enter this code in the app to confirm your email address:</p>
<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">{{ .Token }}</p>
<p>If you didn't create a FinFeast account, you can ignore this email.</p>
```

**Reset password**:

```html
<h2>Reset your FinFeast password</h2>
<p>Enter this code in the app to choose a new password:</p>
<p style="font-size: 28px; font-weight: bold; letter-spacing: 4px;">{{ .Token }}</p>
<p>If you didn't ask to reset your password, you can ignore this email.</p>
```

## 4. Email sending limits

With custom SMTP (Brevo) set up, open **Authentication → Rate Limits** and raise **emails sent per hour** above the low default. This covers sign-up codes, re-sent codes and password resets.

## 5. Site URL

**Authentication → URL Configuration → Site URL**: `https://zwangamj.github.io/FinFeast/`. The code-based flow doesn't use it, but Supabase includes it in some emails.

## 6. Build settings (app and CI)

The app reads two public values at build time:

| Name | Where to find it |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | **Project Settings → API**: Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **Project Settings → API Keys**: the publishable (`sb_publishable_…`) or anon key. Never the secret or service-role key. |

- **Local development**: put both in `.env` (see `.env.example`).
- **GitHub Actions**: add both under **Settings → Secrets and variables → Actions → Variables**. They are deliberately variables, not secrets: they ship inside the app, and row-level security protects the data. CI stops with a clear error if they're missing.

## 7. Mobile builds

Sessions on iOS and Android are stored in the device keychain via `expo-secure-store`, which is a native module. Make a new development build (`npx expo run:ios|android` or `eas build --profile development`). Expo Go can't be used.

## How the app uses accounts

- **Sign-in is required.** Signed-out users only see the sign-in screen.
- **The account's data lives in Supabase.** The app loads it after sign-in and saves changes back automatically.
- **Data from before accounts moves in automatically.** If the device has FinFeast data from before accounts existed, the first sign-in to an *empty* account moves it into that account. An account that already has data keeps its own.
- **Sign out** first waits for unsaved changes to reach the cloud, then removes the account's data from the device.
- **Delete my account** calls `delete_my_account()`. This removes the user and every row of their data, then signs out.
