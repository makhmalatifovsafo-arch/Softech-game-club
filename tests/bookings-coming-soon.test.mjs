import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('booking menu opens its own coming-soon page without loading booking data', () => {
  const html = fs.readFileSync('NetCafeServer/public/index.html', 'utf8');
  const app = fs.readFileSync('NetCafeServer/public/app.js', 'utf8');
  const nav = html.slice(html.indexOf('<!-- 2. Band qilingan -->'), html.indexOf('<!-- 3. Otchyot -->'));
  const view = html.slice(html.indexOf('<section id="view-bookings"'), html.indexOf('<!-- VIEW 3: REPORTS'));

  assert.match(nav, />Band qilingan</);
  assert.doesNotMatch(nav, /Tez orada/);
  assert.match(view, /Tez orada\.\.\./);
  assert.doesNotMatch(app, /showToast\('Band qilingan — Tez orada/);
  assert.doesNotMatch(app, /else if \(viewName === 'bookings'\) \{\s*renderBookingsView\(\)/);
});
