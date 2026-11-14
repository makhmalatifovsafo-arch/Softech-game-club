import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('remote client update is wired end to end and never bypasses an active session', () => {
  const cloud = fs.readFileSync('NetCafeServer/src/services/cloudCommands.js', 'utf8');
  const relay = fs.readFileSync('NetCafeServer/src/services/cloudLicenseService.js', 'utf8');
  const protocol = fs.readFileSync('NetCafeClient/WebSocketClientService.cs', 'utf8');
  const app = fs.readFileSync('NetCafeClient/App.xaml.cs', 'utf8');
  const updater = fs.readFileSync('NetCafeClient/Services/AutoUpdateService.cs', 'utf8');
  const ui = fs.readFileSync('public/views/remoteControlModal.js', 'utf8');

  assert.match(cloud, /FORCE_CLIENT_UPDATE/);
  assert.match(relay, /ClientManager\.send\(client\.pcId,'FORCE_CLIENT_UPDATE'/);
  assert.match(protocol, /case "FORCE_CLIENT_UPDATE"[\s\S]*?OnForceClientUpdate/);
  assert.match(app, /OnForceClientUpdate[\s\S]*?ForceCheckAsync/);
  assert.match(updater, /ForceCheckAsync[\s\S]*?CheckForUpdatesAsync/);
  assert.match(updater, /IdleSafety\.CanApply\(sessionActive\?\.Invoke\(\) \?\? true, maintenance\?\.Invoke\(\) \?\? true/);
  assert.match(ui, /Barcha client kompyuterlarni yangilash/);
});

test('locked kiosk updates are no longer blocked forever by a third-party shell', () => {
  const updater = fs.readFileSync('NetCafeClient/Services/AutoUpdateService.cs', 'utf8');
  assert.doesNotMatch(updater, /HasUserPrograms\(root\)/);
  assert.match(updater, /SafeOnUiThread\(false, IdleSafety\.IdleSeconds\(\)\)/);
});
