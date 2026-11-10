import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MobileAgent } from '../NetCafeServer/src/services/mobileAgent.js';
import { makeRequest, open } from '../public/mobile/crypto.js';

test('whitespace around a mobile login cannot bypass the attempt limit', async () => {
  const db = new DatabaseSync(':memory:');
  let attempts = 0;
  const agent = new MobileAgent({ db, getLicense: () => null, getCloudUrl: () => '',
    isOperational: () => true, localPort: 5000, staffSession: () => null, logout() {},
    fetcher: async () => { attempts++; return new Response(JSON.stringify({ error: 'Wrong password' }), { status: 401 }); }
  });
  try {
    for (let i = 0; i < 9; i++) {
      const packet = await makeRequest(agent.publicKey, 1, { path: '/api/auth/login', method: 'POST',
        body: { username: ' '.repeat(i) + 'manager' + ' '.repeat(i), password: 'wrong' } });
      await agent.execute({ ...packet.job, expires_at: new Date(Date.now() + 30000).toISOString() }, 1);
      const row = db.prepare('SELECT result FROM mobile_local_receipts WHERE id=?').get(packet.job.id);
      const result = await open(packet.key, JSON.parse(row.result), packet.aad + ':reply');
      assert.equal(result.status, i < 8 ? 401 : 429);
    }
    assert.equal(attempts, 8);
  } finally { db.close(); }
});
