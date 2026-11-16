import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {releaseNotes as serverNotes} from '../NetCafeServer/public/release-notes.js';
import {releaseNotes as mobileNotes} from '../public/mobile/release-presentation-data.js';

test('current release has matching, role-specific owner and administrator presentations',()=>{
 const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
 assert.deepEqual(mobileNotes,serverNotes);
 const release=serverNotes[version];assert.ok(release,`v${version} release presentation is missing`);
 for(const role of ['club_owner','administrator']){
  const slides=release.slides.filter(slide=>slide.roles.includes(role));
  assert.ok(slides.length>=2,`${role} needs at least two useful slides`);
  for(const slide of slides){assert.ok(slide.title&&slide.text&&slide.action);assert.ok(!/websocket|api|database|telemetry/i.test(slide.title+' '+slide.text));}
 }
});

test('presentation is shown once per version and account, and remains manually reopenable',()=>{
 const server=fs.readFileSync('NetCafeServer/public/release-presentation.js','utf8');
 const mobile=fs.readFileSync('public/mobile/release-presentation.js','utf8');
 for(const source of [server,mobile]){
  assert.match(source,/softech-release-seen:\$\{audience\}:\$\{role\}:\$\{version\}/);
  assert.match(source,/localStorage\.setItem/);assert.match(source,/aria-modal="true"/);
  assert.match(source,/showIfNeeded/);assert.match(source,/force:true/);
 }
 const serverUi=fs.readFileSync('NetCafeServer/public/index.html','utf8');
 const mobileUi=fs.readFileSync('public/mobile/app.js','utf8');
 assert.match(serverUi,/Versiya yangiliklari/);assert.match(mobileUi,/Versiya yangiliklarini ko‘rish/);
 assert.match(mobileUi,/controllerchange/);assert.match(mobileUi,/state\.action\|\|\$\('#dialog'\)\.open/);
});
