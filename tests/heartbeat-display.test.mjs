import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SupabaseCloudService } from '../src/services/supabaseClient.js';

test('offline duration uses the real heartbeat age instead of a fixed 15 minutes', () => {
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-11-16T12:00:00.000Z');
  try {
    const heartbeat = '2026-11-16T10:27:00.000Z';
    assert.equal(SupabaseCloudService.heartbeatAgeMinutes(heartbeat), 93);
    assert.equal(SupabaseCloudService.isHeartbeatOnline(heartbeat), false);
    const ui=fs.readFileSync('public/views/clubsList.js','utf8');
    assert.doesNotMatch(ui,/parseInt\(minutes[^\n]+\|\|\s*15/,'UI must not invent a fixed 15-minute outage');
    assert.match(ui,/heartbeatAgeMinutes\(club\)/,'UI derives the badge from the heartbeat timestamp');
  } finally { Date.now = realNow; }
});
