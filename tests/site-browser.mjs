// Exercise the generated public/site bundle at its deployment subpath. This
// local fixture handles the static redirect/rewrite subset in vercel.json;
// it never starts a club server or calls a production business API.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const root = resolve(config.outputDirectory);
function match(rule, pathname) {
  // Vercel's sourceToRegex uses strict:true, so trailing slashes are significant.
  const names = [];
  const source = rule.source.split('/').map(part => {
    if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    names.push(part.replace(/^:|\*$/g, '')); return part.endsWith('*') ? '(.*)' : '([^/]+)';
  }).join('/');
  const found = new RegExp('^' + source + '$').exec(pathname);
  if (!found) return null;
  return rule.destination.replace(/:([a-z]+)\*?/g, (_, key) => found[names.indexOf(key) + 1]);
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/ttf' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname.startsWith('/api/')) { res.writeHead(503); res.end('No API in static fixture'); return; }
  for (const rule of config.redirects || []) {
    const to = match(rule, url.pathname);
    if (to) { res.writeHead(308, { Location: to + url.search }); res.end(); return; }
  }
  let pathname = url.pathname;
  for (const rule of config.rewrites) { const to = match(rule, pathname); if (to) { pathname = to; break; } }
  const file = resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
try {
  for (const route of ['/site', '/site/help', '/site/help/seans-ochish']) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200); assert.equal(response.url, origin + route + '/');
  }
  assert.equal((await fetch(origin + '/site/help/unknown-topic/')).status, 404);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['website/softech/scripts/check-site.mjs'], {
      stdio: 'inherit', env: { ...process.env, SOFTECH_SITE_TEST_URL: origin + '/site' }
    });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, 0, 'Website browser checks failed');
  console.log('PASS Vercel subpath bundle: trailing-slash redirects, unknown topic 404, page assets and responsive browser checks.');
} finally { await new Promise(r => server.close(r)); }
