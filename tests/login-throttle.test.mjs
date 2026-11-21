import test from 'node:test';
import assert from 'node:assert/strict';
import { LoginThrottle } from '../NetCafeServer/src/services/loginThrottle.js';

test('login attempts are reserved synchronously and normalize account names across addresses', () => {
  const limiter = new LoginThrottle({ accountLimit: 2 });
  assert.equal(limiter.take('10.0.0.1', 'Cashier').allowed, true);
  assert.equal(limiter.take('10.0.0.2', ' cashier ').allowed, true);
  assert.equal(limiter.take('10.0.0.3', 'CASHIER').allowed, false);
  assert.equal(limiter.take('10.0.0.1', 'manager').allowed, true);
});

test('changing account names cannot bypass the address limit', () => {
  const limiter = new LoginThrottle({ addressLimit: 2 });
  assert.equal(limiter.take('10.0.0.1', 'one').allowed, true);
  assert.equal(limiter.take('10.0.0.1', 'two').allowed, true);
  assert.equal(limiter.take('10.0.0.1', 'three').allowed, false);
  assert.equal(limiter.take('::ffff:10.0.0.1', 'four').allowed, false);
  assert.equal(limiter.take('10.0.0.2', 'three').allowed, true);
});

test('blocked requests do not extend the lockout and expiry permits login again', () => {
  let now = 1000;
  const limiter = new LoginThrottle({ now: () => now, accountLimit: 1, windowMs: 10000 });
  limiter.take('local', 'admin');
  now = 10001;
  assert.deepEqual(limiter.take('local', 'admin'), { allowed: false, retryAfter: 1 });
  now = 11000;
  assert.equal(limiter.take('local', 'admin').allowed, true);
});

test('bucket exhaustion fails closed without evicting active limits, then recovers', () => {
  let now = 0;
  const limiter = new LoginThrottle({ now: () => now, maxBuckets: 3, accountLimit: 1, windowMs: 1000 });
  assert.equal(limiter.take('local', 'one').allowed, true);
  assert.equal(limiter.take('local', 'two').allowed, true);
  for (let i = 0; i < 100; i++) assert.equal(limiter.take('ip' + i, 'user' + i).allowed, false);
  assert.equal(limiter.buckets.size, 3);
  assert.equal(limiter.take('local', 'one').allowed, false);
  now = 1000;
  assert.equal(limiter.take('new', 'new').allowed, true);
  assert.equal(limiter.buckets.size, 2);
});
