import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('client session widget hides for foreign fullscreen windows and restores without activation', () => {
  const xaml = fs.readFileSync('NetCafeClient/TimeWidgetWindow.xaml', 'utf8');
  const source = fs.readFileSync('NetCafeClient/TimeWidgetWindow.xaml.cs', 'utf8');

  assert.match(xaml, /Topmost="True"/);
  assert.match(xaml, /ShowActivated="False"/);
  assert.match(source, /UpdateFullscreenVisibility\(\);[\s\S]*?_expiresAtTimestamp/);
  assert.match(source, /if \(fullscreen && !_hiddenForFullscreen\)[\s\S]*?Hide\(\)/);
  assert.match(source, /else if \(!fullscreen && _hiddenForFullscreen\)[\s\S]*?Show\(\)/);
  assert.match(source, /GetForegroundWindow/);
  assert.match(source, /MonitorFromWindow/);
  assert.match(source, /processId == Environment\.ProcessId/);
  assert.match(source, /_sessionActive = false;[\s\S]*?_timer\.Stop\(\)/);
});
