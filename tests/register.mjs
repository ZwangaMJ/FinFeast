// Lets `node --experimental-strip-types --test` load the app's TypeScript engines
// directly: resolves the `@/` alias to `src/` and extensionless imports to .ts files.
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const src = path.resolve(fileURLToPath(new URL('../src', import.meta.url)));
const CANDIDATES = ['', '.ts', '.tsx', '/index.ts'];

const toFile = (base) => CANDIDATES.map((ext) => base + ext).find((p) => existsSync(p) && statSync(p).isFile()) ?? null;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromParent = context.parentURL?.startsWith('file:') ? path.dirname(fileURLToPath(context.parentURL)) : null;
    const file = specifier.startsWith('@/')
      ? toFile(path.join(src, specifier.slice(2)))
      : fromParent && /^\.\.?\//.test(specifier)
        ? toFile(path.resolve(fromParent, specifier))
        : null;
    return nextResolve(file ? pathToFileURL(file).href : specifier, context);
  },
});
