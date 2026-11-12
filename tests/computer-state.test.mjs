import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = {};
vm.runInNewContext(fs.readFileSync('NetCafeServer/public/computer-state.js', 'utf8'), context);
const state = context.computerState;

test('mobile and desktop use the same computer connection states', () => {
  const canonical = fs.readFileSync('NetCafeServer/public/computer-state.js', 'utf8');
  for (const prefix of ['public/', 'SoftechCloudAdmin/public/']) {
    assert.equal(fs.readFileSync(prefix + 'mobile/computer-state.js', 'utf8'), canonical);
  }
});

test('new and legacy locked computers are never online without a live connection', () => {
  for (const status of ['OFFLINE', 'LOCKED', 'AVAILABLE', 'OCCUPIED']) {
    const pc = { status, isOnline: false, is_online: 0 };
    assert.equal(state(pc).key, 'NEVER_CONNECTED');
    assert.equal(state({ ...pc, lastHeartbeat: '2026-11-10T10:00:00Z' }).key, 'DISCONNECTED');
  }
});
test('connection state takes precedence over active session while online states remain distinct', () => {
  assert.equal(state({ isOnline: false, lastHeartbeat: '2026-11-10', activeSession: {} }).key, 'DISCONNECTED');
  assert.equal(state({ isOnline: true, status: 'LOCKED' }).key, 'AVAILABLE');
  assert.equal(state({ isOnline: true, status: 'LOCKED' }).color, state({ isOnline: true, status: 'AVAILABLE' }).color);
  assert.equal(state({ is_online: 1, status: 'LOCKED', activeSession: {} }).key, 'OCCUPIED');
  assert.equal(state({ isOnline: true, status: 'ONLINE' }).key, 'AVAILABLE');
  assert.equal(state({ isOnline: true, status: 'MAINTENANCE' }).key, 'MAINTENANCE');
});
test('dashboard inline scripts parse after status rendering changes', () => {
  const html = fs.readFileSync('NetCafeServer/public/index.html', 'utf8');
  for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!attributes.includes('src=') && !attributes.includes('application/')) new vm.Script(source);
  }
});
