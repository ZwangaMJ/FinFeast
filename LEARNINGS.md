# Learnings

A running log of improvement cycles: what worked, what to avoid.

## 2026-11-23: E2E build no longer overwrites the deployable `dist/`

### What worked
- Checking the actual artifact (`grep e2e-mock.supabase.co -r dist`) proved the risk was real, not hypothetical.
- `expo export --output-dir dist-e2e` isolates the mock build without changing how the tests run. All 7 E2E tests still pass in about 15 s.

### What didn't
- Several repo files are CRLF (`.gitignore`, `useStore.ts`, `dataRepository.ts`), so plain string replaces miss. Normalise to LF, edit, then restore CRLF.

### Patterns discovered
- E2E runs against `expo export -p web` with `EXPO_PUBLIC_SUPABASE_URL` overridden in Playwright's `webServer.env`. That inlines the mock URL into the bundle, so any test export must go to its own folder.
- Supabase hosted changes are checked without revealing secrets: `secrets list` shows SHA-256 hashes of values.

### Avoid next time
- Don't rely on a README warning ("run export again before deploying") to guard against a footgun. Remove the footgun.
- Don't edit README or other prose containing backticks through bash one-liners. Use the Edit tool or a script file.

### Time spent
- Analysis: 5 min
- Planning: 2 min
- Execution: 8 min
- Total: 15 min
