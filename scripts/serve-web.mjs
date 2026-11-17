// Serves the exported web build (dist/) the way GitHub Pages does:
// under the /FinFeast/ base path, with 404.html as the fallback for unknown paths.
// Used by Playwright (see playwright.config.ts) so tests hit the real build.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const BASE = '/FinFeast';
const PORT = Number(process.env.PORT ?? 3000);
const dist = join(process.cwd(), 'dist');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html not found. Run `npm run export:web` first.');
  process.exit(1);
}

function send(res, status, file) {
  res.writeHead(status, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  if (pathname === '/' || pathname === BASE) {
    res.writeHead(302, { Location: `${BASE}/` });
    return res.end();
  }
  if (!pathname.startsWith(`${BASE}/`)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const file = normalize(join(dist, pathname.slice(BASE.length)));
  if (!file.startsWith(dist + sep) && file !== dist) {
    res.writeHead(403);
    return res.end();
  }

  if (existsSync(file) && statSync(file).isFile()) return send(res, 200, file);
  if (existsSync(join(file, 'index.html'))) return send(res, 200, join(file, 'index.html'));

  const fallback = join(dist, '404.html');
  return send(res, 404, existsSync(fallback) ? fallback : join(dist, 'index.html'));
}).listen(PORT, () => {
  console.log(`Serving dist/ at http://localhost:${PORT}${BASE}/`);
});
