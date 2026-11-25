// Sets the Android app version for a release build from a git tag (vX.Y.Z).
// CI runs this on its own checkout before `expo prebuild`; the change is never committed.
//
//   node scripts/set-android-version.mjs v1.2.3 [path/to/app.json]
//
// - expo.version             → "1.2.3" (shown to users as the version name)
// - expo.android.versionCode → 10203   (must rise with every release, or Android
//                                       refuses to install the APK as an update)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Android's maximum versionCode (Google Play's limit). */
export const MAX_VERSION_CODE = 2100000000;

/** Parses `vX.Y.Z` (or `X.Y.Z`); minor and patch must be 0–99 so version codes stay ordered. */
export function parseReleaseTag(tag) {
  const m = /^v?(\d{1,5})\.(\d{1,2})\.(\d{1,2})$/.exec(String(tag ?? '').trim());
  if (!m) throw new Error(`"${tag}" is not a release tag like v1.2.3 (minor and patch 0–99).`);
  const [major, minor, patch] = m.slice(1).map(Number);
  return { major, minor, patch, version: `${major}.${minor}.${patch}` };
}

/** MAJOR*10000 + MINOR*100 + PATCH: v1.2.3 → 10203, so later releases always get a higher code. */
export function versionCodeFor(tag) {
  const { major, minor, patch } = parseReleaseTag(tag);
  const code = major * 10000 + minor * 100 + patch;
  if (code < 1) throw new Error('Version 0.0.0 has no valid Android versionCode; use v0.0.1 or later.');
  if (code > MAX_VERSION_CODE) throw new Error(`${tag} gives versionCode ${code}, above Android's maximum of ${MAX_VERSION_CODE}.`);
  return code;
}

/** Returns a copy of an app.json object with the release version applied. */
export function withReleaseVersion(appJson, tag) {
  const { version } = parseReleaseTag(tag);
  const expo = appJson.expo ?? {};
  return { ...appJson, expo: { ...expo, version, android: { ...(expo.android ?? {}), versionCode: versionCodeFor(tag) } } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [tag, file = 'app.json'] = process.argv.slice(2);
  try {
    const raw = readFileSync(file, 'utf8');
    const next = withReleaseVersion(JSON.parse(raw), tag);
    writeFileSync(file, JSON.stringify(next, null, 2) + (raw.includes('\r\n') ? '\r\n' : '\n'));
    console.log(`${file}: version ${next.expo.version}, android.versionCode ${next.expo.android.versionCode}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
