import test from 'node:test';
import assert from 'node:assert/strict';
import {resizedBounds,resizeRoom,polygonBounds,polygonProblem,roomVertices} from '../NetCafeServer/public/club-setup-geometry.js';
import {inside} from '../NetCafeServer/public/club-setup-model.js';
import {normalizeSetupDraft} from '../NetCafeServer/src/services/clubSetup.js';

const polygon=[{x:0,y:0},{x:400,y:0},{x:400,y:160},{x:160,y:160},{x:160,y:400},{x:0,y:400}];
test('all room handles anchor the opposite side and stop before a room collapses or grows unbounded',()=>{
  const room={x:40,y:50,width:400,height:300};
  assert.deepEqual(resizedBounds(room,'nw',-50,-80),{x:-10,y:-30,width:450,height:380});
  assert.deepEqual(resizedBounds(room,'se',80,70),{x:40,y:50,width:480,height:370});
  assert.deepEqual(resizedBounds(room,'ne',80,-30),{x:40,y:20,width:480,height:330});
  assert.deepEqual(resizedBounds(room,'sw',-50,70),{x:-10,y:50,width:450,height:370});
  for(const handle of ['nw','n','ne','e','se','s','sw','w'])for(const delta of [-100000,100000]){
    const box=resizedBounds(room,handle,delta,delta);
    assert.ok(box.width>=120&&box.width<=10000&&box.height>=120&&box.height<=10000);
    if(handle.includes('w'))assert.equal(box.x+box.width,room.x+room.width);
    else assert.equal(box.x,room.x);
    if(handle.includes('n'))assert.equal(box.y+box.height,room.y+room.height);
    else assert.equal(box.y,room.y);
  }
});
test('room resizing keeps PC identities and relative positions, polygon geometry and every tariff intact',()=>{
  const original={schemaVersion:1,step:'rooms',expectedComputers:1,rooms:[{id:'room_7',name:'VIP',type:'VIP',...polygonBounds(polygon),polygonPoints:polygon}],
    computers:[{id:'pc_18',number:18,name:'PC-18',roomId:'room_7',ip:'192.168.1.18',mac:'02:00:00:00:00:18',x:80,y:240}],
    tariffs:[{id:'rate_4',roomId:'room_7',name:'Kun',start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],price_per_hour:7000,vipAllowed:false}]};
  const draft=structuredClone(original);
  resizeRoom(draft,original,'room_7',{x:20,y:30,width:200,height:200});
  assert.deepEqual(draft.computers[0],{...original.computers[0],x:60,y:150});
  assert.ok(inside(draft.computers[0],draft.rooms[0]));
  assert.equal(polygonProblem(draft.rooms[0].polygonPoints),'');
  assert.deepEqual(draft.tariffs,original.tariffs);
  assert.deepEqual(normalizeSetupDraft(draft),draft,'the existing setup API must persist new geometry without dropping IDs or pricing');
  assert.deepEqual(original.rooms[0].polygonPoints,polygon,'drag snapshots remain immutable');
  // Repeated pointermove events must resize from the snapshot, not compound the scale.
  resizeRoom(draft,original,'room_7',{x:0,y:0,width:800,height:800});
  assert.equal(draft.computers[0].x,160);assert.equal(draft.computers[0].y,480);
});
test('pen accepts concave rooms and straight intermediate points, rejects crossed, repeated and degenerate walls',()=>{
  assert.equal(polygonProblem(polygon),'');assert.equal(polygonProblem([...polygon].reverse()),'');
  const straight=structuredClone(polygon);straight.splice(1,0,{x:200,y:0});assert.equal(polygonProblem(straight),'');
  assert.match(polygonProblem([{x:0,y:0},{x:400,y:400},{x:0,y:400},{x:400,y:0}]),/kesish/);
  assert.ok(polygonProblem([{x:0,y:0},{x:400,y:400},{x:200,y:200}]));
  assert.ok(polygonProblem([...polygon,polygon[0]]));
  assert.ok(polygonProblem([{x:0,y:0},{x:40,y:0},{x:0,y:40}]));
  assert.ok(polygonProblem([{x:NaN,y:0},...polygon]));
  assert.ok(polygonProblem(polygon.slice(0,2)));
  assert.ok(polygonProblem(Array.from({length:129},()=>({x:0,y:0}))));
  const rect={x:10,y:20,width:300,height:200};
  assert.deepEqual(polygonBounds(roomVertices(rect)),rect);
});
