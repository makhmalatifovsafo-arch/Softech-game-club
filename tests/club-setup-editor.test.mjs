import test from 'node:test';
import assert from 'node:assert/strict';
import {addComputer,bindClient,moveRoom,placeInRoom,inside,draftChanges,stepProblems} from '../NetCafeServer/public/club-setup-model.js';
import {emptySetupDraft,normalizeSetupDraft,evaluateSetupDraft} from '../NetCafeServer/src/services/clubSetup.js';
function sample(){return {...emptySetupDraft(),expectedComputers:2,rooms:[{id:'r',name:'Zal',type:'STANDARD',x:0,y:0,width:400,height:300}]};}
test('setup editor places distinct PCs, binds without duplicates and moves room contents together',()=>{
  const draft=sample(),a=addComputer(draft),b=addComputer(draft);
  assert.equal(a.number,1);assert.equal(b.number,2);assert.ok(inside(a,draft.rooms[0]));assert.notEqual(a.x,b.x);
  bindClient(draft,a.id,{number:1,ip:'192.168.1.1',mac:'02:00:00:00:00:01',connected:true});
  assert.equal(draft.computers.length,2);
  assert.throws(()=>bindClient(draft,b.id,{number:1,ip:'192.168.1.1',connected:true}),/boshqa/);
  assert.throws(()=>bindClient(draft,b.id,{number:2,ip:'192.168.1.2',connected:false}),/Ulangan/);
  const old={x:a.x,y:a.y};moveRoom(draft,'r',100,100);assert.equal(a.x,old.x+100);assert.equal(a.y,old.y+100);
  placeInRoom(draft,a,'unknown');assert.equal(a.roomId,'');
});
test('setup preserves polygon geometry and VIP flags and rejects a PC outside the actual room polygon',()=>{
  const draft=sample();draft.rooms[0].polygonPoints=[{x:0,y:0},{x:400,y:0},{x:0,y:300}];
  draft.tariffs=[{id:'rate',roomId:'r',name:'Kun',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:7000,vipAllowed:false}];
  const pc=addComputer(draft);assert.ok(inside(pc,draft.rooms[0]));
  Object.assign(pc,{x:350,y:250,ip:'192.168.1.2'});
  assert.ok(evaluateSetupDraft(draft,{maxComputers:5}).issues.some(i=>i.code==='PC_POSITION'));
  const normalized=normalizeSetupDraft(draft);assert.deepEqual(normalized.rooms[0].polygonPoints,draft.rooms[0].polygonPoints);assert.equal(normalized.tariffs[0].vipAllowed,false);
  moveRoom(draft,'r',20,40);assert.deepEqual(draft.rooms[0].polygonPoints[0],{x:20,y:40});
});
test('setup review identifies additions, edits and removals; offline PCs do not prevent tariff preparation',()=>{
  const baseline=sample();addComputer(baseline);
  const draft=structuredClone(baseline);draft.rooms[0].name='VIP';draft.computers=[];
  const changes=draftChanges(draft,baseline);assert.equal(changes.length,2);assert.equal(changes[0].kind,'O‘zgartirilgan');assert.equal(changes[1].kind,'Olib tashlangan');
  const readiness={issues:[{step:'computers',code:'PC_OFFLINE'},{step:'computers',code:'PC_IP'}]};
  assert.deepEqual(stepProblems(readiness,'computers').map(i=>i.code),['PC_IP']);
  assert.deepEqual(draftChanges(baseline,baseline),[]);
});
