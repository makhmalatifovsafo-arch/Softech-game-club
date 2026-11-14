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
  assert.match(protocol, /updateReceiptId/);
  assert.match(updater, /VERIFYING[\s\S]*?ConfirmInstalled/);
  assert.match(updater, /client-update-state\.json/);
});

test('fleet telemetry persists version, progress, errors and a post-health receipt end to end',()=>{
  const local=fs.readFileSync('NetCafeServer/src/handlers/protocolDispatcher.js','utf8');
  const heartbeat=fs.readFileSync('NetCafeServer/src/services/cloudLicenseService.js','utf8');
  const cloud=fs.readFileSync('src/services/supabaseClient.js','utf8');
  const inspector=fs.readFileSync('src/services/clubInspector.js','utf8');
  const ui=fs.readFileSync('public/views/clubDetail.js','utf8');
  const migration=fs.readFileSync('migrations/20261114_client_fleet.sql','utf8');
  for(const field of ['client_version','update_status','update_target_version','update_command_id','update_error','update_receipt_id','update_observed_at'])
    assert.match(migration,new RegExp(field));
  assert.match(local,/saveClientUpdateState/);assert.match(heartbeat,/updateReceiptId/);assert.match(cloud,/update_receipt_id/);
  assert.match(inspector,/updateReceiptId/);assert.match(ui,/Shu clientni yangilash/);assert.match(ui,/Tasdiq receipt/);
  assert.match(ui,/Server bilan mos emas/);assert.match(ui,/Client eski/);
});

test('locked kiosk updates are no longer blocked forever by a third-party shell', () => {
  const updater = fs.readFileSync('NetCafeClient/Services/AutoUpdateService.cs', 'utf8');
  assert.doesNotMatch(updater, /HasUserPrograms\(root\)/);
  assert.match(updater, /SafeOnUiThread\(false, IdleSafety\.IdleSeconds\(\)\)/);
});
