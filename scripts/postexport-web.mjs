// Runs after `expo export -p web` to make dist/ (or the folder given as the first argument) ready for GitHub Pages.
// - 404.html: Pages serves this for unknown paths, so deep links and refreshes
//   (e.g. /FinFeast/goals) load the single-page app instead of a 404.
// - .nojekyll: stops Jekyll from dropping files that start with an underscore.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const dist = join(process.cwd(), dir);
const index = join(dist, 'index.html');

if (!existsSync(index)) {
  console.error(`${dir}/index.html not found. Run "expo export -p web" first.`);
  process.exit(1);
}

copyFileSync(index, join(dist, '404.html'));
writeFileSync(join(dist, '.nojekyll'), '');
console.log(`${dir}/ prepared for GitHub Pages (404.html, .nojekyll).`);
