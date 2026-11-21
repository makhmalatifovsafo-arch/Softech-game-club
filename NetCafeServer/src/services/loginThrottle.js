// Reserve attempts before password hashing or cloud calls. Only use the TCP
// peer address: this LAN endpoint must not trust client-supplied proxy headers.
export class LoginThrottle {
  constructor({ now = Date.now, windowMs = 600000, accountLimit = 20, addressLimit = 80, maxBuckets = 4096 } = {}) {
    this.now = now;
    this.windowMs = windowMs;
    this.accountLimit = accountLimit;
    this.addressLimit = addressLimit;
    this.maxBuckets = maxBuckets;
    this.buckets = new Map();
  }

  take(address, username) {
    const now = this.now();
    // Bounded storage, including when an attacker keeps changing usernames.
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    const entries = [
      ['ip:' + String(address || 'unknown').replace(/^::ffff:/i, ''), this.addressLimit],
      ['account:' + username.trim().toLowerCase(), this.accountLimit]
    ];
    let retryAt = now;
    for (const [key, limit] of entries) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.attempts >= limit) retryAt = Math.max(retryAt, bucket.resetAt);
    }
    if (retryAt > now) return { allowed: false, retryAfter: Math.ceil((retryAt - now) / 1000) };

    const missing = entries.filter(([key]) => !this.buckets.has(key)).length;
    if (this.buckets.size + missing > this.maxBuckets) {
      // Never evict an active limit to admit a new attacker-controlled key.
      const earliest = Math.min(...Array.from(this.buckets.values(), bucket => bucket.resetAt));
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((earliest - now) / 1000)) };
    }
    for (const [key] of entries) {
      const bucket = this.buckets.get(key) || { attempts: 0, resetAt: now + this.windowMs };
      bucket.attempts++;
      this.buckets.set(key, bucket);
    }
    return { allowed: true, retryAfter: 0 };
  }
}

// HTTP cashier and WebSocket member logins share the same attempt budget.
export const localLoginThrottle = new LoginThrottle();
