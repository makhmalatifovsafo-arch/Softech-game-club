import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('client tariff is refreshed from the server on heartbeat without duplicate pushes', () => {
  const protocol = fs.readFileSync('NetCafeServer/src/handlers/protocolDispatcher.js', 'utf8');

  assert.match(protocol, /static getClientRateConfig[\s\S]*?getActiveRateForMoment\(new Date\(\), false, clubId, zoneId\)/);
  assert.match(protocol, /static syncClientRate[\s\S]*?client\.rateSignature === signature/);
  assert.match(protocol, /handleHeartbeatPing[\s\S]*?recordHeartbeat\(pcId\)[\s\S]*?syncClientRate\(pcId/);
  assert.match(protocol, /ClientManager\.send\(pcId, 'CONFIG_UPDATE', config\)/);
});

test('checkout notice waits for lock screen and remains visible for exactly eight seconds', () => {
  const app = fs.readFileSync('NetCafeClient/App.xaml.cs', 'utf8');
  const lockWindow = fs.readFileSync('NetCafeClient/LockWindow.xaml.cs', 'utf8');
  const ledger = fs.readFileSync('NetCafeServer/src/services/barLedgerService.js', 'utf8');

  assert.match(app, /OnSessionBarNotice[\s\S]*?ShowSessionBarNoticeAfterLockAsync/);
  assert.match(app, /Task\.Delay\(250\)[\s\S]*?if \(!_isSessionActive\)[\s\S]*?ShowSessionBarNotice/);
  assert.match(lockWindow, /Interval = TimeSpan\.FromSeconds\(8\)/);
  assert.match(ledger, /Siz \$\{preview\.barSummaryText\} olgansiz/);
  assert.match(ledger, /Kassaga \$\{preview\.amountToCollect\.toLocaleString\('uz-UZ'\)\} so‘m to‘lashni unutmang/);
});
